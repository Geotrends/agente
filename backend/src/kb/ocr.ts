/**
 * OCR con confianza medida (RF-C3-IV-07; research R6).
 *
 * Tesseract directo, no `ocrmypdf`: RF-C3-IV-07 exige la confianza media
 * reportada por el motor, y la única fuente directa es el TSV de Tesseract.
 *
 *   PDF     → `pdftoppm -r 300` página por página → Tesseract
 *   DOCX    → las imágenes del documento (word/media) → Tesseract
 *   imagen  → Tesseract
 *
 * La confianza del documento es la media de `conf` de todas sus palabras con
 * `conf >= 0`, de todas sus páginas o imágenes. Sin palabras, 0: un documento
 * del que el motor no reconoce nada nunca se carga.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import mammoth from "mammoth";

const execFileAsync = promisify(execFile);

/** Tope por página o imagen: un escaneo corrupto no bloquea al worker. */
const TIMEOUT_PAGINA_MS = 120_000;

export type ResultadoOcr = { texto: string; confianzaMedia: number; palabras: number };

/** Formatos de imagen que Tesseract lee y que el scraper adquiere (RF-C3-IV-08). */
export const EXTENSIONES_IMAGEN = new Set(["png", "jpg", "jpeg", "tif", "tiff"]);

/** Tipos de imagen embebida en un DOCX que Tesseract puede leer (EMF/WMF no). */
const TIPO_IMAGEN: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/tiff": "tif", "image/bmp": "bmp", "image/gif": "gif",
};

function idioma(): string {
  return process.env.OCR_LANGUAGE?.trim() || "spa+eng";
}

/** Suma y número de palabras con `conf >= 0` de un TSV de Tesseract (nivel 5 = palabra). */
export function palabrasDeTsv(tsv: string): { suma: number; palabras: number } {
  let suma = 0;
  let palabras = 0;
  for (const linea of tsv.split(/\r?\n/).slice(1)) {
    const columnas = linea.split("\t");
    if (columnas.length < 12 || columnas[0] !== "5") continue;
    const conf = Number(columnas[10]);
    if (!Number.isFinite(conf) || conf < 0 || !columnas[11].trim()) continue;
    suma += conf;
    palabras += 1;
  }
  return { suma, palabras };
}

/** Confianza media por palabra de varias páginas o imágenes; 0 si no hay palabras. */
export function confianzaMedia(tsvs: string[]): { confianzaMedia: number; palabras: number } {
  let suma = 0;
  let palabras = 0;
  for (const tsv of tsvs) {
    const p = palabrasDeTsv(tsv);
    suma += p.suma;
    palabras += p.palabras;
  }
  return { confianzaMedia: palabras ? suma / palabras : 0, palabras };
}

/** Pasa una imagen por Tesseract y devuelve su texto y su TSV. */
async function tesseract(imagen: string, dirTmp: string): Promise<{ texto: string; tsv: string }> {
  const salida = path.join(dirTmp, `${path.basename(imagen, path.extname(imagen))}-ocr`);
  await execFileAsync(process.env.TESSERACT_COMMAND || "tesseract", [imagen, salida, "-l", idioma(), "txt", "tsv"], {
    timeout: TIMEOUT_PAGINA_MS, maxBuffer: 16 * 1024 * 1024,
  });
  const [texto, tsv] = await Promise.all([
    fs.readFile(`${salida}.txt`, "utf8"), fs.readFile(`${salida}.tsv`, "utf8"),
  ]);
  return { texto, tsv };
}

async function ocrDeImagenes(imagenes: string[], dirTmp: string): Promise<ResultadoOcr> {
  const textos: string[] = [];
  const tsvs: string[] = [];
  for (const imagen of imagenes) {
    const r = await tesseract(imagen, dirTmp);
    textos.push(r.texto.trim());
    tsvs.push(r.tsv);
  }
  const { confianzaMedia: media, palabras } = confianzaMedia(tsvs);
  return { texto: textos.filter(Boolean).join("\n\n"), confianzaMedia: media, palabras };
}

async function conTemporal<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geobot-ocr-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function paginasPdf(ruta: string): Promise<number> {
  const { stdout } = await execFileAsync(process.env.PDFINFO_COMMAND || "pdfinfo", [ruta], { timeout: TIMEOUT_PAGINA_MS });
  const paginas = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1]);
  if (!Number.isInteger(paginas) || paginas < 1) throw new Error("pdfinfo no reportó el número de páginas");
  return paginas;
}

/** OCR de un PDF: cada página se rasteriza a 300 dpi y se borra al terminar. */
export async function ocrPdf(ruta: string): Promise<ResultadoOcr> {
  return conTemporal(async dir => {
    const textos: string[] = [];
    const tsvs: string[] = [];
    const total = await paginasPdf(ruta);
    for (let pagina = 1; pagina <= total; pagina++) {
      const base = path.join(dir, `p${pagina}`);
      await execFileAsync(process.env.PDFTOPPM_COMMAND || "pdftoppm",
        ["-r", "300", "-png", "-f", String(pagina), "-l", String(pagina), "-singlefile", ruta, base],
        { timeout: TIMEOUT_PAGINA_MS });
      const r = await tesseract(`${base}.png`, dir);
      textos.push(r.texto.trim());
      tsvs.push(r.tsv);
      await fs.rm(`${base}.png`, { force: true });
    }
    const { confianzaMedia: media, palabras } = confianzaMedia(tsvs);
    return { texto: textos.filter(Boolean).join("\n\n"), confianzaMedia: media, palabras };
  });
}

/** OCR de las imágenes de un DOCX, en el orden en que aparecen en el documento. */
export async function ocrDocx(ruta: string): Promise<ResultadoOcr> {
  return conTemporal(async dir => {
    const imagenes: string[] = [];
    await mammoth.convertToHtml({ path: ruta }, {
      convertImage: mammoth.images.imgElement(async imagen => {
        const ext = TIPO_IMAGEN[imagen.contentType];
        if (ext) {
          const destino = path.join(dir, `img${imagenes.length + 1}.${ext}`);
          await fs.writeFile(destino, await imagen.readAsBuffer());
          imagenes.push(destino);
        }
        return { src: "" };
      }),
    });
    return ocrDeImagenes(imagenes, dir);
  });
}

export async function ocrImagen(ruta: string): Promise<ResultadoOcr> {
  return conTemporal(dir => ocrDeImagenes([ruta], dir));
}

/** OCR según la extensión del archivo. */
export async function ocrArchivo(ruta: string): Promise<ResultadoOcr> {
  const ext = path.extname(ruta).toLowerCase().replace(/^\./, "");
  if (ext === "pdf") return ocrPdf(ruta);
  if (ext === "docx") return ocrDocx(ruta);
  if (EXTENSIONES_IMAGEN.has(ext)) return ocrImagen(ruta);
  throw new Error(`OCR no aplica a .${ext}`);
}
