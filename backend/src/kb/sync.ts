/**
 * Sincronización de la base de conocimiento a partir de un informe de corrida
 * (research R1/R2; RF-C3-IV-01..IV-04, IV-11; FR-017).
 *
 *   1. registra la corrida y una verificación por enlace (RF-C3-IV-02);
 *   2. por cada enlace dentro del alcance, actualiza su fila de la matriz y, si
 *      el contenido cambió, crea una versión PENDIENTE: nada nuevo ni
 *      modificado es recuperable hasta que el administrador lo publique
 *      (principio III); la versión publicada sigue en uso mientras tanto;
 *   3. con un informe completo, da de baja los vinculados que ningún GT-P cita
 *      ya —solo si todos sus GT-P se verificaron sin error (contrato, regla 7)—
 *      y avisa de los procedimientos del alcance que faltan.
 *
 * El contenido de cada versión se guarda en PostgreSQL (fuente de verdad):
 * así un archivo sobrescrito en el área de adquisición nunca borra la última
 * versión validada (RF-C3-IV-04).
 */
import path from "node:path";
import { registrarAccion } from "./audit.js";
import { formatoEnBlanco } from "./blankForms.js";
import { encabezadoPagina, fichaProcedimiento } from "./fichas.js";
import { convertirArchivo, hashTexto, registrarProcesamiento, type Conversion } from "./conversion.js";
import { cargarConfig } from "./config.js";
import { enTransaccion, type Pool, type PoolClient } from "./db.js";
import { borrarPuntosElemento } from "./indexer.js";
import { notificar } from "./notifications.js";
import { leerInforme, type Enlace, type InformeCorrida } from "./runReport.js";
import { candidatosDesambiguados, nombreDescriptivo, nombreUnico } from "./nombres.js";
import {
  claveDe, construirContexto, direccionPara, esDelAlcance, procedimientosOrigenPara, tipoPara, type Contexto,
} from "./scope.js";

export type ResumenSincronizacion = {
  corrida: string;
  yaProcesada: boolean;
  /** Otro proceso la está procesando ahora (latido reciente): no se toca. */
  enProceso?: boolean;
  verificaciones: number;
  elementosNuevos: number;
  versionesPendientes: number;
  bajas: string[];
  omitidos: number;
};

export type OpcionesSincronizacion = {
  /** Raíz del área de adquisición; por defecto GEOTRENDS_DOCUMENTS_ROOT. */
  raizDatos?: string;
};

function raizDatos(opciones: OpcionesSincronizacion): string {
  return path.resolve(opciones.raizDatos ?? process.env.GEOTRENDS_DOCUMENTS_ROOT ?? "data");
}

/** Ruta absoluta de un archivo del informe, sin salir de la raíz de datos. */
function rutaSegura(raiz: string, relativa: string): string {
  const absoluta = path.resolve(raiz, relativa);
  if (absoluta !== raiz && !absoluta.startsWith(raiz + path.sep)) {
    throw new Error("ruta del informe fuera del área de adquisición");
  }
  return absoluta;
}

/** Encabezado mínimo (contracts/encabezados-markdown.md, "Documentos sin ficha"). */
export function encabezadoMinimo(campos: { codigo: string | null; nombre: string; urlOrigen: string; fechaAcceso: Date }): string {
  const q = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
  const lineas = [
    ...(campos.codigo ? [`codigo: ${q(campos.codigo)}`] : []),
    `nombre: ${q(campos.nombre)}`,
    `url_origen: ${q(campos.urlOrigen)}`,
    `fecha_acceso: ${q(campos.fechaAcceso.toISOString())}`,
  ];
  return `---\n${lineas.join("\n")}\n---\n\n`;
}

/** Qué archivo aporta el contenido de un elemento y cuál es su descarga. */
function fuenteDeContenido(e: Enlace, ctx: Contexto): { archivo: string | null; descarga: Enlace | null } {
  if (e.rol === "documento") return { archivo: e.archivoOriginal, descarga: null };
  if (e.rol === "vinculado") {
    // Un formato o una norma se representa por su archivo descargable, no por
    // la página del visor (la que trae el texto real del documento).
    const descarga = [...ctx.porUrl.values()].find(d => d.rol === "descarga" && d.padre === e.url && d.resultado !== "error") ?? null;
    if (descarga?.archivoOriginal) return { archivo: descarga.archivoOriginal, descarga };
  }
  return { archivo: e.archivo, descarga: null };
}

type FilaElemento = { id: string; estado: string; version_publicada_id: string | null; version_pendiente_id: string | null; procedimientos_origen: string[] };

async function elementoPorClave(db: Pool | PoolClient, clave: string): Promise<FilaElemento | undefined> {
  const { rows } = await db.query<FilaElemento>(
    "SELECT id, estado, version_publicada_id, version_pendiente_id, procedimientos_origen FROM kb.kb_elemento WHERE clave = $1", [clave]);
  return rows[0];
}

async function hashDeVersion(db: Pool | PoolClient, id: string | null): Promise<string | null> {
  if (!id) return null;
  const { rows } = await db.query<{ hash_contenido: string }>("SELECT hash_contenido FROM kb.kb_version WHERE id = $1", [id]);
  return rows[0]?.hash_contenido ?? null;
}

/**
 * Nombre descriptivo de una página (nombres.ts): el de su URL si es de un boletín y,
 * si otra página ya se llama igual, con el último segmento de la URL añadido.
 */
async function nombreDePagina(db: Pool | PoolClient, clave: string, url: string, titulo: string): Promise<string> {
  const nombre = nombreDescriptivo(url, titulo, cargarConfig());
  const candidatos = [nombre, ...candidatosDesambiguados(nombre, url)];
  const { rows } = await db.query<{ nombre: string }>(
    "SELECT nombre FROM kb.kb_elemento WHERE clave <> $2 AND (nombre = ANY($1) OR nombre LIKE $3)", [candidatos, clave, `${nombre} (%)`]);
  const ocupados = new Set(rows.map(r => r.nombre));
  return nombreUnico(nombre, url, c => ocupados.has(c));
}

/**
 * Actualiza la fila de la matriz de un enlace del alcance y, si su contenido
 * cambió, crea la versión pendiente. Devuelve qué pasó.
 */
async function sincronizarElemento(
  db: Pool, e: Enlace, ctx: Contexto, raiz: string, corridaId: string,
): Promise<"nuevo" | "version" | "sin_cambios" | "omitido"> {
  const clave = claveDe(e);
  const existente = await elementoPorClave(db, clave);
  const { archivo, descarga } = fuenteDeContenido(e, ctx);
  if (!archivo) return "omitido";

  let conversion: Conversion;
  try {
      conversion = await convertirArchivo(rutaSegura(raiz, archivo));
  } catch (error) {
    conversion = {
      texto: "", formatoOriginal: path.extname(archivo).replace(/^\./, "") || "desconocido", caracteresNativos: 0,
      ocrAplicado: false, confianzaOcr: null, calidadNativaBaja: false, decision: "fallo_extraccion",
      detalle: error instanceof Error ? error.message : String(error), duracionMs: 0,
    };
  }
  const tipo = tipoPara(e);
  // RF-C3-IV-10: un formato solo entra en blanco.
  if (tipo === "formato" && conversion.decision === "cargado") {
    const control = formatoEnBlanco(conversion.texto);
    if (!control.enBlanco) {
      conversion = { ...conversion, decision: "formato_diligenciado", detalle: control.motivos.join("; ") };
      await notificar(db, "formato_con_datos_personales", clave,
        `${clave} no se cargó: el archivo descargado parece diligenciado (${control.motivos.join("; ")}). Revísalo en la fuente.`);
    }
  }
  const procesamientoId = await registrarProcesamiento(db, clave, conversion, corridaId);
  // RF-C3-IV-07: un escaneo que no supera la confianza mínima no se carga; si ya
  // había una versión publicada, sigue sirviéndose (aquí no se toca el elemento).
  if (conversion.decision === "descartado_ocr") {
    await notificar(db, "descarte_ocr", clave,
      `${clave} no se cargó: el OCR reportó ${conversion.detalle}. La versión publicada, si existe, se mantiene.`);
  }
  if (conversion.decision === "cargado" && conversion.calidadNativaBaja) {
    await notificar(db, "texto_nativo_ilegible", clave,
      `${clave} se cargó con texto nativo que no parece un idioma legible (capa de texto defectuosa). Revísalo.`);
  }
  if (conversion.decision !== "cargado") return "omitido";

  const origenes = procedimientosOrigenPara(e, ctx, existente?.procedimientos_origen ?? []);
  const direccion = direccionPara(e, ctx, origenes);
  const tituloBase = e.gmas?.nombre || conversion.titulo || e.titulo || decodeURIComponent(new URL(e.url).pathname.split("/").filter(Boolean).pop() ?? e.url);
  const nombre = tipo === "pagina" ? await nombreDePagina(db, clave, e.url, tituloBase) : tituloBase;
  const hash = (e.rol === "pagina" || e.rol === "procedimiento") && e.hashContenido ? e.hashContenido : hashTexto(conversion.texto);
  const fechaAcceso = (descarga ?? e).fechaHora;
  // Ficha de 10 campos para procedimientos (RF-C3-IV-05), encabezado con huella
  // para páginas (IV-06) y encabezado mínimo para el resto.
  const contenido = tipo === "procedimiento" && e.gmas?.version && e.gmas.fechaActualizacion
    ? fichaProcedimiento({
      codigo: e.gmas.codigo, nombre, direccion, estado: e.gmas.estado || "Vigente", urlOrigen: e.url,
      version: e.gmas.version, fechaActualizacion: e.gmas.fechaActualizacion, fechaAcceso, vinculados: e.gmas.vinculados,
    }, conversion.texto)
    : tipo === "pagina"
      ? encabezadoPagina({ urlOrigen: e.url, fechaAcceso, hashContenido: hash, titulo: nombre }, conversion.texto)
      : encabezadoMinimo({ codigo: e.gmas?.codigo ?? null, nombre, urlOrigen: e.url, fechaAcceso }) + conversion.texto;

  // RF-C3-AD-23/25: el mismo contenido (URL + huella) que un administrador rechazó o retiró no
  // reaparece como pendiente; una huella distinta sí vuelve a entrar.
  const { rows: [omitido] } = await db.query<{ type: string }>(
    "SELECT type FROM kb.document_removal WHERE source_url = $1 AND origin = 'scraper' AND content_hash = $2 ORDER BY occurred_at DESC LIMIT 1",
    [e.url, hash]);
  if (omitido) {
    await registrarAccion(db, "kb-worker", omitido.type === "reject" ? "omitir_rechazado" : "omitir_retirado", clave,
      omitido.type === "reject" ? "omitido por rechazo previo" : "omitido por retiro previo");
    return "omitido";
  }

  // La metadata candidata viaja con la versión: la vigente no cambia hasta publicar (R05).
  const candidatos = {
    title: nombre, type: ({ procedimiento: "Procedimiento", formato: "Formato", norma: "Norma", pagina: "Página", documento: "Documento" } as Record<string, string>)[tipo],
    direction: ({ ecosistemas: "Ecosistemas", bienestar_animal: "Bienestar Animal", gestion_ambiental: "Gestión Ambiental", secretaria_general: "Secretaría (general)" } as Record<string, string>)[direccion],
    publicUrl: e.url, version: e.gmas?.version ?? null, updatedDate: e.gmas?.fechaActualizacion ?? null,
  };

  return enTransaccion(db, async client => {
    const { rows: [fila] } = await client.query<FilaElemento & { insertado: boolean }>(
      `INSERT INTO kb.kb_elemento
         (clave, codigo, nombre, tipo, direccion, url_origen, url_padre, url_descarga, estado,
          version_documento, fecha_actualizacion, formato_original, procedimientos_origen, fuente)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pendiente_aprobacion', $9, $10, $11, $12, $13)
       ON CONFLICT (clave) DO UPDATE SET
         codigo = CASE WHEN kb.kb_elemento.version_publicada_id IS NULL THEN EXCLUDED.codigo ELSE kb.kb_elemento.codigo END,
         nombre = CASE WHEN kb.kb_elemento.version_publicada_id IS NULL THEN EXCLUDED.nombre ELSE kb.kb_elemento.nombre END,
         tipo = CASE WHEN kb.kb_elemento.version_publicada_id IS NULL THEN EXCLUDED.tipo ELSE kb.kb_elemento.tipo END,
         direccion = CASE WHEN kb.kb_elemento.version_publicada_id IS NULL THEN EXCLUDED.direccion ELSE kb.kb_elemento.direccion END,
         url_origen = CASE WHEN kb.kb_elemento.version_publicada_id IS NULL THEN EXCLUDED.url_origen ELSE kb.kb_elemento.url_origen END,
         url_padre = EXCLUDED.url_padre, url_descarga = EXCLUDED.url_descarga,
         version_documento = CASE WHEN kb.kb_elemento.version_publicada_id IS NULL THEN EXCLUDED.version_documento ELSE kb.kb_elemento.version_documento END,
         fecha_actualizacion = CASE WHEN kb.kb_elemento.version_publicada_id IS NULL THEN EXCLUDED.fecha_actualizacion ELSE kb.kb_elemento.fecha_actualizacion END,
         formato_original = EXCLUDED.formato_original,
         procedimientos_origen = EXCLUDED.procedimientos_origen,
         fuente = CASE WHEN kb.kb_elemento.origen = 'manual' THEN kb.kb_elemento.fuente ELSE EXCLUDED.fuente END,
         actualizado_en = now()
       RETURNING id, estado, version_publicada_id, version_pendiente_id, procedimientos_origen, (xmax = 0) AS insertado`,
      [clave, e.gmas?.codigo ?? null, nombre, tipo, direccion, e.url,
        e.rol === "documento" ? e.padre : null, e.gmas?.descarga ?? descarga?.url ?? null,
        e.gmas?.version ?? null, e.gmas?.fechaActualizacion ?? null, conversion.formatoOriginal, origenes, e.fuente],
    );

    // Un derogado que vuelve a estar vigente no se recupera solo: espera la
    // aprobación del administrador como cualquier contenido nuevo (RF-C3-IV-03).
    const reactivado = fila.estado === "derogado";
    if (reactivado) {
      await client.query("UPDATE kb.kb_elemento SET estado = 'pendiente_aprobacion', derogado_en = NULL WHERE id = $1", [fila.id]);
    }
    const publicada = await hashDeVersion(client, fila.version_publicada_id);
    const pendiente = await hashDeVersion(client, fila.version_pendiente_id);
    if (hash === pendiente) return fila.insertado ? "nuevo" : "sin_cambios";
    // Con una publicación o un rechazo en curso, la versión aprobada no puede cambiar (SPEC008,
    // NV-02/NV-10): lo nuevo se aplaza y pasa a pendiente cuando la operación termina.
    const { rowCount: operacionActiva } = await client.query(
      `SELECT 1 FROM kb.document_operation WHERE element_id = $1 AND kind IN ('publish','replace','reject')
          AND phase NOT IN ('complete','failed')`, [fila.id]);
    const aplazar = (operacionActiva ?? 0) > 0;
    if (hash === publicada && aplazar) return "sin_cambios";
    if (hash === publicada) {
      if (reactivado) {
        // Mismo contenido que tenía publicado: se vuelve a aprobar esa misma versión.
        await client.query("UPDATE kb.kb_elemento SET version_pendiente_id = version_publicada_id WHERE id = $1", [fila.id]);
        return "version";
      }
      // El contenido volvió a ser el publicado: la pendiente ya no hace falta.
      if (fila.version_pendiente_id) {
        await client.query("UPDATE kb.kb_elemento SET version_pendiente_id = NULL WHERE id = $1", [fila.id]);
        if (fila.version_pendiente_id !== fila.version_publicada_id) {
          await client.query("DELETE FROM kb.kb_version WHERE id = $1", [fila.version_pendiente_id]);
        }
      }
      return "sin_cambios";
    }
    const { rows: [version] } = await client.query<{ id: string }>(
      `INSERT INTO kb.kb_version (elemento_id, hash_contenido, hash_original, contenido_md, fecha_acceso, metadatos_gmas, procesamiento_id,
                                  origen, metadatos_candidatos)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'scraper', $8::jsonb)
       ON CONFLICT (elemento_id, hash_contenido) DO UPDATE SET contenido_md = EXCLUDED.contenido_md
       RETURNING id`,
      [fila.id, hash, descarga?.hashOriginal ?? e.hashOriginal, contenido, fechaAcceso,
        e.gmas ? JSON.stringify(e.gmas) : null, procesamientoId, JSON.stringify(candidatos)],
    );
    if (aplazar) {
      const { rows: [previa] } = await client.query<{ version_aplazada_id: string | null }>(
        "SELECT version_aplazada_id FROM kb.kb_elemento WHERE id = $1", [fila.id]);
      await client.query("UPDATE kb.kb_elemento SET version_aplazada_id = $2 WHERE id = $1", [fila.id, version.id]);
      const vieja = previa?.version_aplazada_id;
      if (vieja && vieja !== version.id && vieja !== fila.version_publicada_id && vieja !== fila.version_pendiente_id) {
        await client.query("DELETE FROM kb.kb_version WHERE id = $1", [vieja]);
      }
      return "version";
    }
    await client.query("UPDATE kb.kb_elemento SET version_pendiente_id = $2 WHERE id = $1", [fila.id, version.id]);
    // La pendiente anterior solo se borra si no es, a la vez, la publicada (derogado reactivado, NV-09).
    if (fila.version_pendiente_id && fila.version_pendiente_id !== version.id && fila.version_pendiente_id !== fila.version_publicada_id) {
      await client.query("DELETE FROM kb.kb_version WHERE id = $1", [fila.version_pendiente_id]);
    }
    return fila.insertado ? "nuevo" : "version";
  });
}

async function registrarVerificacion(db: Pool, corridaId: string, e: Enlace): Promise<void> {
  const elemento = await elementoPorClave(db, claveDe(e));
  await db.query(
    `INSERT INTO kb.kb_verificacion
       (corrida_id, url, elemento_id, fecha_hora, estado_detectado, resultado, tipo_error, codigo_http, hash_contenido)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [corridaId, e.url, elemento?.id ?? null, e.fechaHora, e.estadoDetectado, e.resultado,
      e.error?.tipo ?? null, e.error?.tipo === "http" ? e.error.codigoHttp : null, e.hashContenido],
  );
}

/**
 * Un documento que la fuente declara derogado sale de la recuperación en el
 * acto (RF-C3-IV-03): se marca, se borran sus puntos y se avisa. Si era un
 * procedimiento, sus vinculados pierden ese origen y, los que quedan sin
 * ningún GT-P vigente, salen de la base como fuera de alcance.
 */
async function aplicarDerogado(db: Pool, e: Enlace, informe: InformeCorrida, ctx: Contexto): Promise<void> {
  const clave = claveDe(e);
  const el = await elementoPorClave(db, clave);
  if (!el || el.estado === "derogado") return;
  await borrarPuntosElemento(el.id);
  await db.query("UPDATE kb.kb_elemento SET estado = 'derogado', derogado_en = now(), actualizado_en = now() WHERE id = $1", [el.id]);
  await notificar(db, "documento_derogado", clave,
    `${clave} figura como derogado en la fuente (detectado el ${new Date(e.fechaHora).toISOString()}, corrida ${informe.runId}). Ya no se usa en las respuestas.`);
  await registrarAccion(db, "kb-worker", "derogar", clave, "marcado derogado y retirado del índice");

  if (!(clave in ctx.config.procedimientos)) return;
  const { rows } = await db.query<{ id: string; clave: string; procedimientos_origen: string[] }>(
    "SELECT id, clave, procedimientos_origen FROM kb.kb_elemento WHERE $1 = ANY(procedimientos_origen) AND clave <> $1", [clave]);
  for (const v of rows) {
    const restantes = v.procedimientos_origen.filter(c => c !== clave);
    if (restantes.length) {
      await db.query("UPDATE kb.kb_elemento SET procedimientos_origen = $2, actualizado_en = now() WHERE id = $1", [v.id, restantes]);
      continue;
    }
    await borrarPuntosElemento(v.id);
    await db.query("DELETE FROM kb.kb_elemento WHERE id = $1", [v.id]);
    await notificar(db, "fuera_de_alcance", v.clave,
      `${v.clave} salió de la base: su único procedimiento de origen, ${clave}, está derogado (corrida ${informe.runId}).`);
    await registrarAccion(db, "kb-worker", "baja_fuera_de_alcance", v.clave, `origen ${clave} derogado`);
  }
}

/**
 * Un enlace que falló no toca versiones (RF-C3-IV-04): solo se avisa, una
 * notificación por URL mientras no se revise. Un hijo "no alcanzado" porque su
 * GT-P falló no repite el aviso: el del padre ya lo explica.
 */
async function notificarError(db: Pool, e: Enlace, ctx: Contexto): Promise<void> {
  if (!e.error) return;
  if (e.error.detalle === "no alcanzado") {
    const { rows } = await db.query<{ procedimientos_origen: string[] }>(
      "SELECT procedimientos_origen FROM kb.kb_elemento WHERE url_origen = $1 OR url_descarga = $1", [e.url]);
    const origenes = rows.flatMap(r => r.procedimientos_origen);
    const { rows: padres } = await db.query<{ url_origen: string }>(
      "SELECT url_origen FROM kb.kb_elemento WHERE clave = ANY($1::text[])", [origenes]);
    // Un GT-P que falló no trae metadatos: se reconoce por su URL en el informe.
    if (padres.some(p => ctx.porUrl.get(p.url_origen)?.resultado === "error")) return;
  }
  const http = e.error.tipo === "http" && e.error.codigoHttp ? ` (HTTP ${e.error.codigoHttp})` : "";
  await notificar(db, "verificacion_fallida", e.url,
    `No se pudo verificar ${e.url}: ${e.error.tipo}${http}${e.error.detalle ? ` — ${e.error.detalle}` : ""}. Se conserva la versión validada.`);
}

/**
 * Bajas de un informe completo (contrato, regla 7): un vinculado sale de la
 * base solo si TODOS sus GT-P de origen se verificaron sin error en esta
 * corrida y ninguno lo cita ya. Si algún origen no se pudo verificar, se
 * conserva intacto (RF-C3-IV-04).
 */
async function procesarBajas(db: Pool, informe: InformeCorrida, ctx: Contexto): Promise<string[]> {
  const bajas: string[] = [];
  const { rows } = await db.query<{ id: string; clave: string; codigo: string; procedimientos_origen: string[] }>(
    `SELECT id, clave, codigo, procedimientos_origen FROM kb.kb_elemento
      WHERE fuente = 'gmas2_envigado' AND NOT (codigo = ANY($1::text[]))`,
    [Object.keys(ctx.config.procedimientos)],
  );
  for (const el of rows) {
    const origenes = el.procedimientos_origen.filter(c => c in ctx.config.procedimientos);
    const verificados = origenes.map(c => ctx.procedimientos.get(c));
    if (!origenes.length || verificados.some(p => !p || p.resultado === "error" || !p.gmas)) continue;
    const siguen = origenes.filter(c => ctx.procedimientos.get(c)!.gmas!.vinculados.some(v => v.codigo === el.codigo));
    if (siguen.length === origenes.length) continue;
    if (siguen.length) {
      await db.query("UPDATE kb.kb_elemento SET procedimientos_origen = $2, actualizado_en = now() WHERE id = $1", [el.id, siguen]);
      continue;
    }
    await borrarPuntosElemento(el.id);
    await db.query("DELETE FROM kb.kb_elemento WHERE id = $1", [el.id]);
    await notificar(db, "fuera_de_alcance", el.clave,
      `${el.clave} dejó de estar citado por ${origenes.join(", ")} y salió de la base (corrida ${informe.runId}).`);
    await registrarAccion(db, "kb-worker", "baja_fuera_de_alcance", el.clave, "eliminado de la matriz y del índice");
    bajas.push(el.clave);
  }
  return bajas;
}

/** Minutos sin latido tras los que una corrida en proceso se da por abandonada y se retoma. */
const ABANDONO_MIN = Number(process.env.KB_CORRIDA_ABANDONO_MIN ?? 10);

async function latido(db: Pool, corridaId: string): Promise<void> {
  await db.query("UPDATE kb.kb_corrida SET latido_en = now() WHERE id = $1", [corridaId]);
}

async function urlsVerificadas(db: Pool, corridaId: string): Promise<Set<string>> {
  const { rows } = await db.query<{ url: string }>("SELECT url FROM kb.kb_verificacion WHERE corrida_id = $1", [corridaId]);
  return new Set(rows.map(r => r.url));
}

/**
 * Reclama la corrida para este proceso. "propia": hay que procesarla (nueva o
 * abandonada); "procesada": ya terminó; "en_proceso": otro proceso la trabaja.
 * El reclamo es atómico en PostgreSQL, así que el worker y el CLI no la duplican.
 */
async function reclamarCorrida(db: Pool, informe: InformeCorrida, ruta: string): Promise<"propia" | "procesada" | "en_proceso"> {
  const { rowCount } = await db.query(
    `INSERT INTO kb.kb_corrida (id, iniciada_en, terminada_en, programada, completa, informe, estado, latido_en)
     VALUES ($1, $2, $3, $4, $5, $6, 'en_proceso', now()) ON CONFLICT (id) DO NOTHING`,
    [informe.runId, informe.iniciadaEn, informe.terminadaEn, informe.programada, informe.completa, path.basename(ruta)],
  );
  if (rowCount) return "propia";
  const retomada = await db.query(
    `UPDATE kb.kb_corrida SET latido_en = now()
      WHERE id = $1 AND estado = 'en_proceso' AND latido_en < now() - make_interval(mins => $2)`,
    [informe.runId, ABANDONO_MIN],
  );
  if (retomada.rowCount) return "propia";
  const { rows } = await db.query<{ estado: string }>("SELECT estado FROM kb.kb_corrida WHERE id = $1", [informe.runId]);
  return rows[0]?.estado === "en_proceso" ? "en_proceso" : "procesada";
}

/** Procesa un informe de corrida. Idempotente: una corrida ya procesada no se repite. */
export async function procesarInforme(db: Pool, ruta: string, opciones: OpcionesSincronizacion = {}): Promise<ResumenSincronizacion> {
  const informe = await leerInforme(ruta);
  const resumen: ResumenSincronizacion = {
    corrida: informe.runId, yaProcesada: false, verificaciones: 0, elementosNuevos: 0,
    versionesPendientes: 0, bajas: [], omitidos: 0,
  };
  const reclamo = await reclamarCorrida(db, informe, ruta);
  if (reclamo === "procesada") return { ...resumen, yaProcesada: true };
  if (reclamo === "en_proceso") return { ...resumen, enProceso: true };

  const config = cargarConfig();
  const ctx = construirContexto(informe.enlaces, config);
  const raiz = raizDatos(opciones);

  // Retoma: los enlaces ya verificados de un intento anterior no se repiten.
  const hechos = await urlsVerificadas(db, informe.runId);

  try {
  for (const e of informe.enlaces) {
    if (hechos.has(e.url)) continue;
    await latido(db, informe.runId);
    if (e.estadoDetectado === "derogado") await aplicarDerogado(db, e, informe, ctx);
    else if (e.resultado === "error") await notificarError(db, e, ctx);
    if (e.resultado !== "error" && e.estadoDetectado !== "derogado" && esDelAlcance(e, ctx).ok) {
      const resultado = await sincronizarElemento(db, e, ctx, raiz, informe.runId);
      if (resultado === "nuevo") { resumen.elementosNuevos++; resumen.versionesPendientes++; }
      else if (resultado === "version") resumen.versionesPendientes++;
      else if (resultado === "omitido") resumen.omitidos++;
    }
    await registrarVerificacion(db, informe.runId, e);
    resumen.verificaciones++;
  }

  if (informe.completa && informe.fuentes.includes("gmas2_envigado")) {
    resumen.bajas = await procesarBajas(db, informe, ctx);
    for (const codigo of Object.keys(config.procedimientos)) {
      if (!ctx.procedimientos.has(codigo)) {
        await notificar(db, "procedimiento_faltante", codigo,
          `${codigo} es uno de los procedimientos del alcance pero no apareció en la corrida ${informe.runId}.`);
      }
    }
  }
  await db.query("UPDATE kb.kb_corrida SET estado = 'procesada', procesada_en = now() WHERE id = $1", [informe.runId]);
  } catch (error) {
    // Libera el reclamo para que el siguiente ciclo la retome sin esperar el plazo de abandono.
    await db.query("UPDATE kb.kb_corrida SET latido_en = now() - interval '1 day' WHERE id = $1 AND estado = 'en_proceso'", [informe.runId]).catch(() => undefined);
    throw error;
  }
  return resumen;
}
