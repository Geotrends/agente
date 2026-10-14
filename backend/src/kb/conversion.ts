/**
 * Conversión de lo adquirido a Markdown y registro de procesamiento
 * (RF-C3-IV-07, IV-08; research R6/R7).
 *
 * Cada conversión deja una fila en `kb_procesamiento`: conteo de caracteres
 * nativos, si se aplicó OCR, la confianza del OCR y la decisión (cargado o el
 * motivo del descarte). Es el "registro de procesamiento" de RF-C3-IV-08 y el
 * registro de descartes de RF-C3-IV-07.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { stripFrontmatter } from "../services/chunking.js";
import { looksLikeGarbage, preprocessDocument } from "../services/documentPreprocessor.js";
import { setting } from "../services/settings.js";
import type { Pool, PoolClient } from "./db.js";
import { sanitizarDescripcion } from "./notifications.js";
import { EXTENSIONES_IMAGEN, OcrLimiteError, ocrArchivo } from "./ocr.js";

export type Decision = "cargado" | "descartado_ocr" | "formato_diligenciado" | "fallo_extraccion";

export type Conversion = {
  texto: string;
  titulo?: string;
  formatoOriginal: string;
  caracteresNativos: number;
  ocrAplicado: boolean;
  confianzaOcr: number | null;
  calidadNativaBaja: boolean;
  decision: Decision;
  detalle: string | null;
  duracionMs: number;
};

/** Separador de páginas de pdf-parse: no es contenido (ver documentPreprocessor.ts). */
const SEPARADOR_PAGINA = /--\s*\d+\s*of\s*\d+\s*--/g;

/** Caracteres no blancos, sin separadores de página: la medida de RF-C3-IV-08 (research R7). */
export function contarCaracteresNativos(texto: string): number {
  return texto.replace(SEPARADOR_PAGINA, "").replace(/\s/g, "").length;
}

/** Hash del texto normalizado (espacios colapsados, minúsculas): estable ante formato. */
export function hashTexto(texto: string): string {
  const normalizado = texto.replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha256").update(normalizado).digest("hex");
}

export function formatoDe(ruta: string): string {
  const ext = path.extname(ruta).toLowerCase().replace(/^\./, "");
  return ext === "md" ? "html" : ext || "desconocido";
}

/**
 * Convierte un archivo adquirido. Las páginas ya llegan como Markdown del
 * scraper (se les quita el frontmatter del scraper); los documentos pasan por
 * el preprocesador.
 */
export async function convertirArchivo(ruta: string): Promise<Conversion> {
  const inicio = Date.now();
  const formatoOriginal = formatoDe(ruta);
  if (ruta.toLowerCase().endsWith(".md")) {
    const { body, title } = stripFrontmatter(await fs.readFile(ruta, "utf8"));
    const texto = body.trim();
    return {
      texto, titulo: title, formatoOriginal, caracteresNativos: contarCaracteresNativos(texto),
      ocrAplicado: false, confianzaOcr: null, calidadNativaBaja: false,
      decision: texto ? "cargado" : "fallo_extraccion", detalle: texto ? null : "página sin contenido",
      duracionMs: Date.now() - inicio,
    };
  }
  const ext = path.extname(ruta).toLowerCase().replace(/^\./, "");
  const esImagen = EXTENSIONES_IMAGEN.has(ext);
  const admiteOcr = esImagen || ext === "pdf" || ext === "docx";
  const falla = (detalle: string, nativos = 0, extra: Partial<Conversion> = {}): Conversion => ({
    texto: "", formatoOriginal, caracteresNativos: nativos, ocrAplicado: false, confianzaOcr: null,
    calidadNativaBaja: false, decision: "fallo_extraccion", detalle, duracionMs: Date.now() - inicio, ...extra,
  });

  // Texto nativo. Una imagen no tiene; un PDF o DOCX sin texto es "empty" para el
  // preprocesador pero para nosotros es 0 caracteres: candidato a OCR (R7).
  let nativo = "";
  if (!esImagen) {
    const extraccion = await preprocessDocument(ruta);
    if (extraccion.ok) nativo = extraccion.text;
    else if (!(extraccion.reason === "empty" && admiteOcr)) return falla(extraccion.detail);
  }
  const caracteresNativos = contarCaracteresNativos(nativo);

  // RF-C3-IV-08: OCR solo con menos de 80 caracteres nativos, o si es una imagen.
  const umbral = setting("ocrMinTextChars");
  if (!esImagen && !(admiteOcr && caracteresNativos < umbral)) {
    return {
      texto: nativo, formatoOriginal, caracteresNativos, ocrAplicado: false, confianzaOcr: null,
      calidadNativaBaja: admiteOcr && looksLikeGarbage(nativo), decision: "cargado", detalle: null,
      duracionMs: Date.now() - inicio,
    };
  }
  if (!admiteOcr) return falla("sin texto extraíble", caracteresNativos);
  if (!setting("ocrEnabled")) return falla("el documento requiere OCR y OCR_ENABLED=false", caracteresNativos);

  // RF-C3-IV-07: se carga solo si la confianza media del motor supera el mínimo.
  let ocr;
  try {
    ocr = await ocrArchivo(ruta);
  } catch (error) {
    if (error instanceof OcrLimiteError) {
      // Excede los topes de trabajo: se descarta con motivo y la cola de operaciones sigue (NV-06).
      return {
        texto: "", formatoOriginal, caracteresNativos, ocrAplicado: true, confianzaOcr: null, calidadNativaBaja: false,
        decision: "descartado_ocr", detalle: error.message, duracionMs: Date.now() - inicio,
      };
    }
    return falla(`OCR falló: ${error instanceof Error ? error.message : String(error)}`, caracteresNativos, { ocrAplicado: true });
  }
  const confianzaOcr = Math.round(ocr.confianzaMedia * 100) / 100;
  const minimo = setting("ocrMinConfidence");
  const base = {
    formatoOriginal, caracteresNativos, ocrAplicado: true, confianzaOcr, calidadNativaBaja: false,
    duracionMs: Date.now() - inicio,
  };
  if (confianzaOcr <= minimo) {
    return { ...base, texto: "", decision: "descartado_ocr", detalle: `confianza media ${confianzaOcr} <= ${minimo}` };
  }
  const texto = [nativo.trim(), ocr.texto.trim()].filter(Boolean).join("\n\n");
  return { ...base, texto, decision: "cargado", detalle: null };
}

/** Registra la conversión en `kb_procesamiento` y devuelve el id. */
export async function registrarProcesamiento(
  db: Pool | PoolClient, clave: string, c: Conversion, corridaId: string | null = null,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO kb.kb_procesamiento
       (clave_elemento, formato_original, caracteres_nativos, ocr_aplicado, confianza_ocr,
        calidad_nativa_baja, decision, detalle, duracion_ms, corrida_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (corrida_id, clave_elemento) DO UPDATE SET
       formato_original = EXCLUDED.formato_original, caracteres_nativos = EXCLUDED.caracteres_nativos,
       ocr_aplicado = EXCLUDED.ocr_aplicado, confianza_ocr = EXCLUDED.confianza_ocr,
       calidad_nativa_baja = EXCLUDED.calidad_nativa_baja, decision = EXCLUDED.decision,
       detalle = EXCLUDED.detalle, duracion_ms = EXCLUDED.duracion_ms, fecha = now()
     RETURNING id`,
    [clave, c.formatoOriginal, c.caracteresNativos, c.ocrAplicado, c.confianzaOcr,
      c.calidadNativaBaja, c.decision, c.detalle === null ? null : sanitizarDescripcion(c.detalle), c.duracionMs, corridaId],
  );
  return rows[0].id;
}
