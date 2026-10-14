/**
 * Worker de operaciones documentales (SPEC007 T033/T035/T037, research R04).
 *
 * Una operación es un comando durable creado por el panel con la cuenta de la sesión. El worker
 * es el ÚNICO escritor: las ejecuta en orden de llegada, una a la vez, por fases persistidas
 * (`queued → preparing → prepared → committed → reconciling → cleaning → complete | failed`).
 * «Terminada» solo existe cuando la limpieza quedó confirmada; un reinicio retoma desde la fase
 * guardada verificando la realidad, sin consumir intentos de más.
 *
 *  · publicar/reemplazar/reindexar: colección candidata completa → commit SQL → alias espejo →
 *    limpieza. Máximo DOS intentos de indexación; el segundo fallo deja lo anterior intacto.
 *  · rechazar: registro seguro + eliminación de la versión pendiente y su archivo.
 *  · retirar: exclusión inmediata (retirado_en) → puntos fuera de TODA colección → filas → archivos.
 *  · metadata: sincroniza el payload de Qdrant (la consulta ya usa la metadata nueva por SQL).
 */
import type { Embedder } from "./indexer.js";
import { borrarPuntosElemento, contarPuntos } from "./indexer.js";
import { enTransaccion, type Pool } from "./db.js";
import { registrarAccion } from "./audit.js";
import { eliminarArchivo } from "./documentFiles.js";
import { notificar } from "./notifications.js";
import { refrescarManifiestoActivo, reconciliarAlias } from "./publicationManifest.js";
import type { CalibrationReport } from "./calibration.js";
import { ErrorPublicacion, limpiarColeccion, reconstruirColeccion, type FaseGeneracion } from "./service.js";
import { aliasKb, qdrant } from "../services/qdrant.js";

export type OpcionesOperaciones = {
  embedder?: Embedder;
  calibrar?: (coleccion: string, info: { corpusHash: string }) => Promise<CalibrationReport>;
  graciaMs?: number;
};

type Operacion = {
  id: string; kind: "publish" | "replace" | "reject" | "withdraw" | "reindex" | "metadata";
  actor_account_id: string; element_id: string | null; phase: string; attempts: number;
  previous_collection: string | null; candidate_collection: string | null; payload: Record<string, unknown> | null;
  cleanup_pending: boolean; target_version_id: string | null;
};

const actorDe = (op: Operacion) => `cuenta:${op.actor_account_id}`;

async function guardar(db: Pool, id: string, cambios: Record<string, unknown>): Promise<void> {
  const columnas = Object.keys(cambios);
  const valores = Object.values(cambios);
  await db.query(
    `UPDATE kb.document_operation SET ${columnas.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
    [id, ...valores]);
}

const terminar = async (db: Pool, id: string, fase: "complete" | "failed", extra: Record<string, unknown> = {}): Promise<void> => {
  await guardar(db, id, { phase: fase, finished_at: new Date(), ...extra });
  // Al terminar la operación, la versión que llegó mientras tanto pasa a pendiente (SPEC008, FR-006).
  const { rows: [o] } = await db.query<{ element_id: string | null }>("SELECT element_id FROM kb.document_operation WHERE id = $1", [id]);
  await promoverAplazada(db, o?.element_id ?? null);
};

/**
 * Una carga o detección recibida con una publicación/rechazo en curso se guardó como «aplazada»
 * para no cambiar el objetivo de la operación. Al terminar, pasa a ser la pendiente (y requiere su
 * propia aprobación); la pendiente anterior, si ya no es la publicada, se descarta con su archivo.
 */
async function promoverAplazada(db: Pool, elementoId: string | null): Promise<void> {
  if (!elementoId) return;
  const archivos: string[] = [];
  await enTransaccion(db, async client => {
    const { rows: [e] } = await client.query(
      `SELECT version_aplazada_id, version_pendiente_id, version_publicada_id FROM kb.kb_elemento WHERE id = $1 FOR UPDATE`, [elementoId]);
    if (!e?.version_aplazada_id) return;
    const activa = await client.query(
      `SELECT 1 FROM kb.document_operation WHERE element_id = $1 AND kind IN ('publish','replace','reject')
          AND phase NOT IN ('complete','failed')`, [elementoId]);
    if (activa.rowCount) return;
    const anterior: string | null = e.version_pendiente_id && e.version_pendiente_id !== e.version_aplazada_id
      && e.version_pendiente_id !== e.version_publicada_id ? e.version_pendiente_id : null;
    if (anterior) {
      const { rows: [v] } = await client.query("SELECT archivo_ref FROM kb.kb_version WHERE id = $1", [anterior]);
      if (v?.archivo_ref) archivos.push(v.archivo_ref);
    }
    await client.query(
      `UPDATE kb.kb_elemento SET version_pendiente_id = version_aplazada_id, version_aplazada_id = NULL,
              revision = revision + 1, actualizado_en = now() WHERE id = $1`, [elementoId]);
    if (anterior) await client.query("DELETE FROM kb.kb_version WHERE id = $1", [anterior]);
  });
  for (const ref of archivos) await eliminarArchivo(ref).catch(() => false);
}

/** Colecciones físicas de esta base de conocimiento (prefijo del alias). */
async function inventarioColecciones(): Promise<string[]> {
  const { collections } = await qdrant(120_000).getCollections();
  const prefijo = `${aliasKb()}_`;
  return collections.map(c => c.name).filter(n => n.startsWith(prefijo));
}

/** Reintentos rápidos antes de pedir atención (FR-008): 15 s·2ⁿ → 15, 30, 60, 120 y 240 s. */
export const REINTENTOS_RAPIDOS = 5;
export const ESPERA_BASE_S = 15;
export const ESPERA_LARGA_S = 60 * 60;

/** Espera tras el fallo número `intento` (1 = primero). Después de los rápidos, una hora. */
export function esperaTrasFallo(intento: number): number {
  return intento <= REINTENTOS_RAPIDOS ? ESPERA_BASE_S * 2 ** (intento - 1) : ESPERA_LARGA_S;
}

/**
 * Aparta la operación de la cola hasta su próximo intento (NV-07, NV-08): ni se declara fallida ni
 * bloquea a las que esperan detrás. Al agotar los reintentos rápidos pide atención una sola vez y
 * sigue reintentando con espera larga.
 */
async function reprogramar(db: Pool, op: Operacion, motivo: string): Promise<void> {
  const { rows: [r] } = await db.query<{ cleanup_attempts: number; needs_attention: boolean }>(
    "SELECT cleanup_attempts, needs_attention FROM kb.document_operation WHERE id = $1", [op.id]);
  const intento = (r?.cleanup_attempts ?? 0) + 1;
  await db.query(
    `UPDATE kb.document_operation
        SET cleanup_attempts = $2, next_attempt_at = now() + make_interval(secs => $3), updated_at = now(),
            needs_attention = needs_attention OR $4, error_code = COALESCE(error_code, 'limpieza_pendiente')
      WHERE id = $1`,
    [op.id, intento, esperaTrasFallo(intento), intento >= REINTENTOS_RAPIDOS]);
  if (intento === REINTENTOS_RAPIDOS && !r?.needs_attention) {
    await notificar(db, "indexacion_fallida", `operacion:${op.id}`,
      `La operación «${op.kind}» no pudo completarse tras ${REINTENTOS_RAPIDOS} intentos (${motivo}). Sigue reintentándose cada hora; puede reanudarla desde el panel.`);
  }
}

/** Procesa la cola completa. Devuelve cuántas operaciones terminó (o dejó terminadas/fallidas/en espera). */
export async function procesarOperaciones(db: Pool, opciones: OpcionesOperaciones = {}): Promise<number> {
  let n = 0;
  for (;;) {
    const { rows } = await db.query<Operacion>(
      `SELECT id, kind, actor_account_id, element_id, phase, attempts, previous_collection, candidate_collection, payload, cleanup_pending, target_version_id
         FROM kb.document_operation
        WHERE phase NOT IN ('complete', 'failed') AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY created_at, id LIMIT 1`);
    const op = rows[0];
    if (!op) return n;
    const antes = op.phase;
    try {
      await ejecutar(db, op, opciones);
    } catch (error) {
      console.error(`[kb-worker] operación ${op.id} (${op.kind}): ${error instanceof Error ? error.message : error}`);
      if (op.kind === "withdraw" || op.kind === "reject" || op.kind === "metadata") {
        // Fallo transitorio (almacén vectorial, base, disco): se reintenta, nunca queda terminal.
        await reprogramar(db, op, "error transitorio");
        n++;
        continue;
      }
      await terminar(db, op.id, "failed", { error_code: "error_interno" });
    }
    n++;
    // Una limpieza pendiente deja la operación «En curso»: se programa su reintento y la cola sigue.
    const { rows: [despues] } = await db.query(
      "SELECT phase, cleanup_pending, (next_attempt_at IS NULL OR next_attempt_at <= now()) AS sin_espera FROM kb.document_operation WHERE id = $1", [op.id]);
    if (despues && !["complete", "failed"].includes(despues.phase)) {
      if (despues.phase === antes || despues.cleanup_pending) {
        if (despues.sin_espera) await reprogramar(db, op, "limpieza pendiente");
      }
    }
  }
}

async function ejecutar(db: Pool, op: Operacion, o: OpcionesOperaciones): Promise<void> {
  switch (op.kind) {
    case "publish": case "replace": case "reindex": return publicar(db, op, o);
    case "reject": return rechazar(db, op);
    case "withdraw": return retirar(db, op);
    case "metadata": return sincronizarMetadata(db, op);
  }
}

// ── publicar / reemplazar / reindexar ───────────────────────────────────────

async function publicar(db: Pool, op: Operacion, o: OpcionesOperaciones): Promise<void> {
  let clave: string | null = null;
  let versionPublicadaId: string | null = null;
  let autor: string | null = null;
  if (op.kind !== "reindex") {
    const { rows } = await db.query(
      `SELECT e.clave, e.version_publicada_id, e.version_pendiente_id, v.autor_cuenta_id
         FROM kb.kb_elemento e LEFT JOIN kb.kb_version v ON v.id = e.version_pendiente_id WHERE e.id = $1`, [op.element_id]);
    const e = rows[0];
    if (!e) { await terminar(db, op.id, "failed", { error_code: "documento_inexistente" }); return; }
    clave = e.clave; versionPublicadaId = e.version_publicada_id; autor = e.autor_cuenta_id;
    // Reanudación tras un commit confirmado: ya no hay versión pendiente y la operación avanzó.
    const yaConfirmada = !e.version_pendiente_id && ["committed", "reconciling", "cleaning"].includes(op.phase);
    if (!e.version_pendiente_id && !yaConfirmada) {
      await terminar(db, op.id, "failed", { error_code: "sin_candidata" });
      return;
    }
  }

  // Fases posteriores al commit: solo reconciliar y limpiar.
  if (["committed", "reconciling", "cleaning"].includes(op.phase)) {
    await reanudarTrasCommit(db, op, o);
    return;
  }

  // Un reinicio durante la preparación: la candidata parcial se elimina y se verifica antes de reintentar.
  if (op.candidate_collection) await descartarCandidata(db, op, op.candidate_collection);

  // Archivos del contenido que será reemplazado (se borran al confirmar la limpieza).
  if (versionPublicadaId && !op.payload?.archivosAnteriores) {
    const { rows } = await db.query("SELECT archivo_ref FROM kb.kb_version WHERE id = $1 AND archivo_ref IS NOT NULL", [versionPublicadaId]);
    await guardar(db, op.id, { payload: JSON.stringify({ ...(op.payload ?? {}), archivosAnteriores: rows.map(r => r.archivo_ref) }) });
  }

  let intentos = op.attempts;
  for (;;) {
    if (intentos >= 2) {
      await terminar(db, op.id, "failed", { error_code: "indexacion_fallida" });
      await notificar(db, "indexacion_fallida", clave ?? "kb_chunks",
        clave
          ? `La publicación de ${clave} falló dos veces. Se conserva la versión anterior y el documento sigue pendiente.`
          : "La reindexación completa falló dos veces. Se conserva la base anterior.",
        { propietario: autor, identidadDocumento: op.element_id });
      return;
    }
    intentos++;
    await guardar(db, op.id, {
      phase: "preparing", attempts: intentos, candidate_collection: null, error_code: null,
      ...(intentos === 1 && op.attempts === 0 ? { started_at: new Date() } : {}),
    });
    try {
      const fase = async (f: FaseGeneracion, info: { candidata: string; anterior?: string }) => {
        const cambios: Record<string, unknown> = { candidate_collection: info.candidata };
        if (f === "prepared") { cambios.phase = "prepared"; cambios.previous_collection = info.anterior ?? null; }
        if (f === "committed") { cambios.phase = "committed"; cambios.previous_collection = info.anterior ?? null; cambios.cleanup_pending = true; }
        if (f === "reconciling") cambios.phase = "reconciling";
        if (f === "cleaning") cambios.phase = "cleaning";
        await guardar(db, op.id, cambios);
      };
      const r = await reconstruirColeccion(db, actorDe(op), {
        promover: clave ? [clave] : [],
        objetivos: clave && op.target_version_id ? { [clave]: op.target_version_id } : undefined,
        embedder: o.embedder, calibrar: o.calibrar, graciaMs: o.graciaMs, onFase: fase, operacionId: op.id, avisarFallo: false,
      });
      await finalizarTrasCommit(db, op, r.limpiezaPendiente, o);
      return;
    } catch (error) {
      const { rows } = await db.query("SELECT candidate_collection, phase FROM kb.document_operation WHERE id = $1", [op.id]);
      // Si ya se confirmó, no es un fallo de indexación: se reanuda reconciliación/limpieza.
      if (rows[0] && ["committed", "reconciling", "cleaning"].includes(rows[0].phase)) {
        await guardar(db, op.id, { cleanup_pending: true, error_code: "limpieza_pendiente" });
        return;
      }
      if (rows[0]?.candidate_collection) await descartarCandidata(db, op, rows[0].candidate_collection);
      if (error instanceof ErrorPublicacion && error.codigo === "candidata_cambiada") {
        // No es un fallo de indexación: la versión aprobada ya no es la pendiente. Se conserva
        // lo vigente y lo recibido queda pendiente; reintentar no cambiaría el resultado.
        await terminar(db, op.id, "failed", { error_code: "candidata_cambiada" });
        await notificar(db, "indexacion_fallida", clave ?? "kb_chunks",
          `La publicación de ${clave ?? "la base"} no se realizó: la versión pendiente cambió después de la aprobación. Se conserva la versión vigente; revise y apruebe de nuevo.`,
          { propietario: autor, identidadDocumento: op.element_id });
        await promoverAplazada(db, op.element_id);
        return;
      }
      await guardar(db, op.id, { error_code: "indexacion_fallida" });
      console.warn(`[kb-worker] intento ${intentos} de la operación ${op.id} falló: ${error instanceof Error ? error.message : error}`);
    }
  }
}

/** Elimina una candidata parcial y comprueba su ausencia antes de cualquier reintento. */
async function descartarCandidata(db: Pool, op: Operacion, coleccion: string): Promise<void> {
  const activa = (await db.query("SELECT collection_name FROM kb.active_generation")).rows[0]?.collection_name;
  if (coleccion === activa) return;
  const cliente = qdrant(120_000);
  if ((await cliente.collectionExists(coleccion)).exists) await cliente.deleteCollection(coleccion);
  const ausente = !(await cliente.collectionExists(coleccion)).exists;
  await db.query(
    `INSERT INTO kb.cleanup_receipt (operation_id, object_kind, object_ref, verified_absent, detail)
     VALUES ($1,'coleccion',$2,$3,'candidata parcial descartada')`, [op.id, coleccion, ausente]);
  if (!ausente) throw new Error("la candidata parcial no se pudo eliminar");
  await guardar(db, op.id, { candidate_collection: null });
}

async function reanudarTrasCommit(db: Pool, op: Operacion, o: OpcionesOperaciones): Promise<void> {
  await guardar(db, op.id, { phase: "reconciling" });
  await reconciliarAlias(db, aliasKb());
  await guardar(db, op.id, { phase: "cleaning" });
  let pendiente = false;
  if (op.previous_collection) pendiente = !(await limpiarColeccion(db, op.previous_collection, { operacionId: op.id, graciaMs: o.graciaMs }));
  await finalizarTrasCommit(db, op, pendiente, o);
}

async function finalizarTrasCommit(db: Pool, op: Operacion, limpiezaPendiente: boolean, _o: OpcionesOperaciones): Promise<void> {
  if (limpiezaPendiente) {
    await guardar(db, op.id, { phase: "cleaning", cleanup_pending: true, error_code: "limpieza_pendiente" });
    await notificar(db, "indexacion_fallida", "kb_chunks", "La publicación está confirmada, pero la colección anterior aún no se pudo eliminar. Se reintentará.");
    return;
  }
  // Archivos del contenido anterior: «cero copias antiguas» antes de declarar Terminada.
  const archivos = (op.payload?.archivosAnteriores as string[] | undefined) ?? [];
  for (const ref of archivos) {
    const ausente = await eliminarArchivo(ref).catch(() => false);
    await db.query(
      `INSERT INTO kb.cleanup_receipt (operation_id, object_kind, object_ref, verified_absent) VALUES ($1,'archivo',$2,$3)`,
      [op.id, ref, ausente]);
    if (!ausente) {
      await guardar(db, op.id, { phase: "cleaning", cleanup_pending: true, error_code: "limpieza_pendiente" });
      return;
    }
  }
  await terminar(db, op.id, "complete", { cleanup_pending: false, error_code: null });
}

// ── rechazar (versión pendiente) ────────────────────────────────────────────

async function rechazar(db: Pool, op: Operacion): Promise<void> {
  const motivo = String(op.payload?.motivo ?? "").trim();
  let archivos: string[] = [];
  let aviso: { clave: string; nombre: string; autor: string | null; id: string } | null = null;
  const resultado = await enTransaccion(db, async client => {
    const { rows: [e] } = await client.query(
      `SELECT e.id, e.clave, e.nombre, e.url_origen, e.origen, e.version_publicada_id, e.version_pendiente_id,
              v.hash_contenido, v.archivo_ref, v.origen AS version_origen, v.autor_cuenta_id AS autor
         FROM kb.kb_elemento e LEFT JOIN kb.kb_version v ON v.id = e.version_pendiente_id
        WHERE e.id = $1 FOR UPDATE OF e`, [op.element_id]);
    if (!e || !e.version_pendiente_id) return "sin_candidata" as const;
    await client.query(
      `INSERT INTO kb.document_removal (type, element_key, identity_id, document_name, source_url, origin, content_hash, reason, actor_account_id)
       VALUES ('reject',$1,$2,$3,$4,$5,$6,$7,$8)`,
      [e.clave, e.id, e.nombre, e.url_origen, e.version_origen, e.hash_contenido, motivo || "sin motivo", op.actor_account_id]);
    // Pendiente == publicada (derogado reactivado): se quita la marca de pendiente sin borrar la
    // versión vigente ni su archivo (NV-09).
    const mismaQuePublicada = e.version_publicada_id && e.version_pendiente_id === e.version_publicada_id;
    if (e.archivo_ref && !mismaQuePublicada) archivos = [e.archivo_ref];
    if (e.version_publicada_id) {
      // Se descarta solo la nueva versión: la vigente sigue intacta.
      await client.query("UPDATE kb.kb_elemento SET version_pendiente_id = NULL, revision = revision + 1, actualizado_en = now() WHERE id = $1", [e.id]);
      if (!mismaQuePublicada) await client.query("DELETE FROM kb.kb_version WHERE id = $1", [e.version_pendiente_id]);
    } else {
      await client.query("DELETE FROM kb.kb_elemento WHERE id = $1", [e.id]);
    }
    await registrarAccion(client, actorDe(op), "rechazar", e.clave, "rechazado");
    aviso = { clave: e.clave, nombre: e.nombre, autor: e.autor ?? null, id: e.id };
    return "ok" as const;
  });
  if (resultado === "sin_candidata") { await terminar(db, op.id, "failed", { error_code: "sin_candidata" }); return; }
  // Quien subió el documento ve el rechazo con su motivo (aviso de carga; solo si el autor es verificable).
  if (aviso) {
    const a = aviso as { clave: string; nombre: string; autor: string | null; id: string };
    await notificar(db, "carga_rechazada", a.clave, `El administrador rechazó «${a.nombre}». Motivo: ${motivo || "sin motivo"}`,
      { propietario: a.autor, identidadDocumento: a.id });
  }
  await guardar(db, op.id, { phase: "committed" });
  await guardar(db, op.id, { phase: "cleaning" });
  for (const ref of archivos) {
    const ausente = await eliminarArchivo(ref).catch(() => false);
    await db.query(`INSERT INTO kb.cleanup_receipt (operation_id, object_kind, object_ref, verified_absent) VALUES ($1,'archivo',$2,$3)`, [op.id, ref, ausente]);
    if (!ausente) { await guardar(db, op.id, { cleanup_pending: true, error_code: "limpieza_pendiente" }); return; }
  }
  await terminar(db, op.id, "complete", { cleanup_pending: false });
}

// ── retirar (versión publicada) ─────────────────────────────────────────────

async function retirar(db: Pool, op: Operacion): Promise<void> {
  const motivo = String(op.payload?.motivo ?? "").trim();
  // Paso 1: exclusión inmediata y registro seguro (si aún no se hizo).
  const { rows: [e] } = await db.query(
    `SELECT e.id, e.clave, e.nombre, e.url_origen, e.origen, e.retirado_en, e.version_publicada_id, v.hash_contenido
       FROM kb.kb_elemento e LEFT JOIN kb.kb_version v ON v.id = e.version_publicada_id WHERE e.id = $1`, [op.element_id]);
  if (!e) {
    // Ya eliminado por un intento anterior: nada más que verificar.
    await terminar(db, op.id, "complete", { cleanup_pending: false });
    return;
  }
  if (!e.retirado_en) {
    if (!e.version_publicada_id) { await terminar(db, op.id, "failed", { error_code: "sin_vigente" }); return; }
    await enTransaccion(db, async client => {
      await client.query(
        `INSERT INTO kb.document_removal (type, element_key, identity_id, document_name, source_url, origin, content_hash, reason, actor_account_id)
         VALUES ('withdraw',$1,$2,$3,$4,$5,$6,$7,$8)`,
        [e.clave, e.id, e.nombre, e.url_origen, e.origen, e.hash_contenido, motivo || "sin motivo", op.actor_account_id]);
      await client.query("UPDATE kb.kb_elemento SET retirado_en = now(), revision = revision + 1 WHERE id = $1", [e.id]);
      await registrarAccion(client, actorDe(op), "retirar", e.clave, "retirado (exclusión inmediata)");
    });
  }
  await guardar(db, op.id, { phase: "committed" });
  await guardar(db, op.id, { phase: "cleaning" });

  // Paso 2: eliminación física en TODAS las colecciones administradas y verificación de cero.
  for (const coleccion of await inventarioColecciones()) {
    if ((await contarPuntos(coleccion, e.id)) > 0) await borrarPuntosElemento(e.id, coleccion);
    const restantes = await contarPuntos(coleccion, e.id);
    await db.query(
      `INSERT INTO kb.cleanup_receipt (operation_id, object_kind, object_ref, verified_absent, detail) VALUES ($1,'puntos',$2,$3,$4)`,
      [op.id, `${coleccion}:${e.id}`, restantes === 0, `puntos restantes: ${restantes}`]);
    if (restantes > 0) { await guardar(db, op.id, { cleanup_pending: true, error_code: "limpieza_pendiente" }); return; }
  }
  // Paso 3: SQL y archivos.
  const { rows: archivos } = await db.query("SELECT archivo_ref FROM kb.kb_version WHERE elemento_id = $1 AND archivo_ref IS NOT NULL", [e.id]);
  await enTransaccion(db, async client => {
    await client.query("DELETE FROM kb.kb_elemento WHERE id = $1", [e.id]);
    await refrescarManifiestoActivo(client);
  });
  for (const { archivo_ref } of archivos) {
    const ausente = await eliminarArchivo(archivo_ref).catch(() => false);
    await db.query(`INSERT INTO kb.cleanup_receipt (operation_id, object_kind, object_ref, verified_absent) VALUES ($1,'archivo',$2,$3)`, [op.id, archivo_ref, ausente]);
    if (!ausente) { await guardar(db, op.id, { cleanup_pending: true, error_code: "limpieza_pendiente" }); return; }
  }
  await terminar(db, op.id, "complete", { cleanup_pending: false, error_code: null });
}

// ── metadata ────────────────────────────────────────────────────────────────

async function sincronizarMetadata(db: Pool, op: Operacion): Promise<void> {
  const { rows: [e] } = await db.query(
    `SELECT id, codigo, nombre, direccion, url_origen, url_padre, fecha_actualizacion FROM kb.kb_elemento WHERE id = $1 AND retirado_en IS NULL`,
    [op.element_id]);
  const activa = (await db.query("SELECT collection_name FROM kb.active_generation")).rows[0]?.collection_name as string | undefined;
  if (e && activa) {
    const titulo = e.codigo && !e.nombre.toUpperCase().startsWith(String(e.codigo).toUpperCase()) ? `${e.codigo} - ${e.nombre}` : e.nombre;
    await qdrant(120_000).setPayload(activa, {
      wait: true,
      payload: {
        titulo, direccion: e.direccion, url: e.url_origen, url_padre: e.url_padre, codigo: e.codigo,
        fecha_actualizacion: e.fecha_actualizacion instanceof Date ? e.fecha_actualizacion.toISOString().slice(0, 10) : e.fecha_actualizacion,
      },
      filter: { must: [{ key: "elemento_id", match: { value: e.id } }] },
    });
  }
  await terminar(db, op.id, "complete", { cleanup_pending: false });
}
