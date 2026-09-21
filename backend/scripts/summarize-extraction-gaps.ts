/**
 * Resume `_documentos-sin-texto-<raíz>.csv` por motivo, para triar sin abrir
 * el CSV entero a mano.
 *
 *     npm run extraction:gaps
 *
 * El reporte lo escribe `search.ts` en cada construcción del índice
 * (hallazgo A-3); esto solo lo lee y lo agrupa. Los motivos vienen de
 * `ExtractionFailureReason` en documentPreprocessor.ts:
 *
 *   ocr_failed        — se intentó OCR (dos configuraciones) y seguía vacío
 *                       o era ilegible. El más común y el que vale la pena
 *                       mirar caso por caso: puede ser un escaneo torcido
 *                       que otra config arreglaría, o un manuscrito que no.
 *   empty             — el archivo no tenía nada que extraer de entrada.
 *   unsupported       — extensión que el sistema no sabe leer.
 *   converter_failed  — soffice (conversión de .doc) falló.
 *   read_error        — cualquier excepción no prevista.
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { getDocumentsRootPath } from "../src/services/context.js";
import { retrievalCacheDir } from "../src/services/embeddings.js";
import { rootScope } from "../src/services/indexSnapshot.js";
import { parseCsvRows as parseCsv } from "../src/shared/csv.js";


const root = getDocumentsRootPath();
const file = path.join(retrievalCacheDir, `_documentos-sin-texto-${rootScope(root)}.csv`);

let raw: string;
try {
  raw = await fs.readFile(file, "utf8");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    console.log(`\n${path.relative(process.cwd(), file)} no existe: no hay documentos sin texto, o el índice no se ha construido todavía.`);
    process.exit(0);
  }
  throw error;
}

const table = parseCsv(raw);
const [header, ...rows] = table;
const idx = (name: string) => header.indexOf(name);
const col = { ruta: idx("ruta"), motivo: idx("motivo"), detalle: idx("detalle") };

console.log(`\n═══ DOCUMENTOS SIN TEXTO, POR MOTIVO ═══\n`);
console.log(`${path.relative(process.cwd(), file)}\n`);

const byReason = new Map<string, Array<{ path: string; detail: string }>>();
for (const cells of rows) {
  const reason = col.motivo >= 0 ? (cells[col.motivo] || "(sin motivo)") : "(formato antiguo, sin motivo)";
  const list = byReason.get(reason) ?? [];
  list.push({ path: cells[col.ruta] ?? "", detail: col.detalle >= 0 ? (cells[col.detalle] ?? "") : "" });
  byReason.set(reason, list);
}

const total = rows.length;
console.log(`${total} documentos indexables sin texto utilizable.\n`);

for (const [reason, entries] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${reason.padEnd(18)} ${String(entries.length).padStart(5)}  (${((entries.length / total) * 100).toFixed(1)} %)`);
}

const ocrFailed = byReason.get("ocr_failed") ?? [];
if (ocrFailed.length) {
  console.log(`\n  Muestra de "ocr_failed" (hasta 10, para revisar a mano):`);
  for (const entry of ocrFailed.slice(0, 10)) {
    console.log(`    ${entry.path}`);
    console.log(`      ${entry.detail}`);
  }
  if (ocrFailed.length > 10) console.log(`    ... y ${ocrFailed.length - 10} más.`);
}

console.log("");
