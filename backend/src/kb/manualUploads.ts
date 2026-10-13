/**
 * Procesamiento de cargas manuales (SPEC007 T032): el mismo pipeline local de SPEC001 que el
 * scraper (conversión, OCR ≤ 80 caracteres nativos, confianza mínima, formatos en blanco). Una
 * carga que no lo supera NO se publica, no deja el archivo y avisa a su autora o autor.
 */
import { enTransaccion, type Pool } from "./db.js";
import { registrarAccion } from "./audit.js";
import { formatoEnBlanco } from "./blankForms.js";
import { convertirArchivo, hashTexto, registrarProcesamiento, type Conversion } from "./conversion.js";
import { eliminarArchivo, resolverReferencia } from "./documentFiles.js";
import { notificar } from "./notifications.js";
import { encabezadoMinimo } from "./sync.js";

type FilaCarga = {
  version_id: string; elemento_id: string; clave: string; codigo: string | null; nombre: string;
  url_origen: string; archivo_ref: string; autor: string | null; tipo: string; version_publicada_id: string | null;
  hash_publicado: string | null;
};

/** Marca «en cola» las que quedaron a medias por un reinicio del worker. */
export async function reanudarCargas(db: Pool): Promise<number> {
  const r = await db.query("UPDATE kb.kb_version SET estado_tecnico = 'en_cola' WHERE estado_tecnico = 'procesando'");
  return r.rowCount ?? 0;
}

async function reclamar(db: Pool): Promise<FilaCarga | undefined> {
  const { rows } = await db.query<FilaCarga>(
    `UPDATE kb.kb_version v SET estado_tecnico = 'procesando'
       FROM kb.kb_elemento e
      WHERE v.id = (SELECT id FROM kb.kb_version WHERE estado_tecnico = 'en_cola' AND origen = 'manual'
                      ORDER BY subida_en NULLS LAST LIMIT 1 FOR UPDATE SKIP LOCKED)
        AND e.id = v.elemento_id
      RETURNING v.id AS version_id, e.id AS elemento_id, e.clave, e.codigo, e.nombre, e.url_origen, v.archivo_ref,
                v.autor_cuenta_id AS autor, e.tipo::text AS tipo, e.version_publicada_id,
                (SELECT hash_contenido FROM kb.kb_version p WHERE p.id = e.version_publicada_id) AS hash_publicado`);
  return rows[0];
}

/** Procesa las cargas en cola. Devuelve cuántas terminó (cargadas o descartadas). */
export async function procesarCargasManuales(db: Pool, opciones: { limite?: number } = {}): Promise<number> {
  let hechas = 0;
  const limite = opciones.limite ?? 10;
  while (hechas < limite) {
    const c = await reclamar(db);
    if (!c) break;
    try {
      await procesarUna(db, c);
    } catch (error) {
      await db.query("UPDATE kb.kb_version SET estado_tecnico = 'error' WHERE id = $1", [c.version_id]);
      await notificar(db, "carga_rechazada", c.clave, `${c.clave} no se pudo procesar por un error interno. Vuelva a cargarlo.`,
        { propietario: c.autor, identidadDocumento: c.elemento_id });
      console.error(`[kb-worker] carga ${c.version_id}: ${error instanceof Error ? error.message : error}`);
    }
    hechas++;
  }
  return hechas;
}

async function procesarUna(db: Pool, c: FilaCarga): Promise<void> {
  let conversion: Conversion;
  try {
    conversion = await convertirArchivo(resolverReferencia(c.archivo_ref));
  } catch (error) {
    conversion = {
      texto: "", formatoOriginal: c.archivo_ref.split(".").pop() ?? "desconocido", caracteresNativos: 0, ocrAplicado: false,
      confianzaOcr: null, calidadNativaBaja: false, decision: "fallo_extraccion",
      detalle: error instanceof Error ? error.message : String(error), duracionMs: 0,
    };
  }
  // RF-C3-IV-10: un formato solo entra en blanco.
  if (c.tipo === "formato" && conversion.decision === "cargado") {
    const control = formatoEnBlanco(conversion.texto);
    if (!control.enBlanco) conversion = { ...conversion, decision: "formato_diligenciado", detalle: control.motivos.join("; ") };
  }
  const procesamientoId = await registrarProcesamiento(db, c.clave, conversion, null);
  const owner = { propietario: c.autor, identidadDocumento: c.elemento_id };

  if (conversion.decision !== "cargado") {
    // Lo no cargable no se conserva: ni texto ni archivo (puede traer datos personales).
    await db.query("UPDATE kb.kb_version SET estado_tecnico = 'descartado', procesamiento_id = $2, archivo_ref = NULL WHERE id = $1",
      [c.version_id, procesamientoId]);
    await eliminarArchivo(c.archivo_ref);
    if (conversion.decision === "descartado_ocr") {
      await notificar(db, "descarte_ocr", c.clave,
        `${c.clave} no se cargó: el OCR reportó ${conversion.detalle}. El documento anterior, si existe, se mantiene.`, owner);
    } else if (conversion.decision === "formato_diligenciado") {
      await notificar(db, "formato_con_datos_personales", c.clave,
        `${c.clave} no se cargó: el archivo parece diligenciado (${conversion.detalle}). Cargue el formato en blanco.`, owner);
    } else {
      await notificar(db, "carga_rechazada", c.clave, `${c.clave} no se cargó: no se pudo extraer su texto (${conversion.detalle ?? "sin detalle"}).`, owner);
    }
    return;
  }

  const hash = hashTexto(conversion.texto);
  if (c.hash_publicado && hash === c.hash_publicado) {
    // Mismo contenido que ya está publicado: la carga no aporta nada y no queda pendiente.
    await enTransaccion(db, async client => {
      await client.query("UPDATE kb.kb_elemento SET version_pendiente_id = NULL WHERE id = $1 AND version_pendiente_id = $2", [c.elemento_id, c.version_id]);
      await client.query("DELETE FROM kb.kb_version WHERE id = $1", [c.version_id]);
    });
    await eliminarArchivo(c.archivo_ref);
    await notificar(db, "carga_rechazada", c.clave, `${c.clave}: el contenido cargado es idéntico al publicado; no se creó una versión nueva.`, owner);
    return;
  }
  const contenido = encabezadoMinimo({ codigo: c.codigo, nombre: c.nombre, urlOrigen: c.url_origen, fechaAcceso: new Date() }) + conversion.texto;
  await enTransaccion(db, async client => {
    await client.query(
      `UPDATE kb.kb_version SET contenido_md = $2, hash_contenido = $3, procesamiento_id = $4, estado_tecnico = 'procesado', fecha_acceso = now()
        WHERE id = $1`, [c.version_id, contenido, hash, procesamientoId]);
    await registrarAccion(client, c.autor ? `cuenta:${c.autor}` : "kb-worker", "procesar_carga", c.clave, "procesada");
  });
  if (conversion.calidadNativaBaja) {
    await notificar(db, "texto_nativo_ilegible", c.clave,
      `${c.clave} se cargó con texto nativo que no parece un idioma legible (capa de texto defectuosa). Revíselo.`, owner);
  }
}
