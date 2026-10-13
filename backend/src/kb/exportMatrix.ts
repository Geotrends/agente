/**
 * Exportación de la matriz documental a .xlsx (RF-C3-IV-12; contrato
 * contracts/matriz-xlsx.md). Una hoja, 12 columnas en el orden de
 * RF-C3-IV-11, una fila por elemento en cualquier estado.
 *
 * Las celdas son siempre texto: el contenido viene de páginas externas y un
 * nombre que empiece por `=`, `+`, `-` o `@` se ejecutaría como fórmula al
 * abrirlo en Excel. Se antepone un apóstrofo (principio de seguridad).
 */
import fs from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";
import { kbPool, type Pool } from "./db.js";

export const HOJA = "Matriz documental";

/** Columna de la vista `kb.v_matriz` → encabezado del contrato, en orden. */
export const COLUMNAS: ReadonlyArray<readonly [campo: string, encabezado: string]> = [
  ["codigo", "Código"],
  ["nombre", "Nombre"],
  ["tipo", "Tipo"],
  ["direccion", "Dirección responsable"],
  ["url_origen", "URL de origen"],
  ["estado", "Estado"],
  ["version", "Versión"],
  ["fecha_actualizacion", "Fecha de última actualización"],
  ["formato_original", "Formato original"],
  ["uso_ocr", "Uso de OCR"],
  ["fecha_carga", "Fecha de carga"],
  ["procedimiento_origen", "Procedimiento de origen"],
];

export type FilaMatriz = Record<string, string | null> & { tipo_interno?: string | null };

/** Neutraliza la inyección de fórmulas en una celda de texto. */
export function celdaSegura(valor: string | null | undefined): string {
  const texto = String(valor ?? "");
  return /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
}

/** Hoja con encabezados y una fila por elemento. */
export function construirHoja(filas: FilaMatriz[]): XLSX.WorkSheet {
  const datos = [
    COLUMNAS.map(([, encabezado]) => encabezado),
    ...filas.map(f => COLUMNAS.map(([campo]) => celdaSegura(f[campo]))),
  ];
  const hoja = XLSX.utils.aoa_to_sheet(datos, { cellDates: false });
  // Todo es texto: ni números ni fechas que Excel reinterprete.
  for (const ref of Object.keys(hoja)) {
    if (ref.startsWith("!")) continue;
    const celda = hoja[ref] as XLSX.CellObject;
    celda.t = "s";
    celda.v = String(celda.v ?? "");
  }
  hoja["!cols"] = [14, 48, 14, 22, 60, 22, 9, 16, 12, 10, 18, 28].map(wch => ({ wch }));
  return hoja;
}

export function dirExportaciones(): string {
  return process.env.KB_EXPORT_DIR?.trim() || "/app/var/exports";
}

/** `yyyy-mm-dd` en America/Bogota: el día del administrador, no el UTC. */
function fechaBogota(ahora: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(ahora);
}

export async function filasDeLaMatriz(db: Pool = kbPool()): Promise<FilaMatriz[]> {
  const { rows } = await db.query<FilaMatriz>(
    "SELECT * FROM kb.v_matriz ORDER BY tipo_interno, COALESCE(NULLIF(codigo, 'N/A'), nombre), nombre");
  return rows;
}

/** Escribe `matriz-documental-<yyyy-mm-dd>.xlsx` y devuelve su ruta y el número de filas. */
export async function exportarMatriz(
  db: Pool = kbPool(), salida: string = dirExportaciones(), ahora = new Date(),
): Promise<{ ruta: string; filas: number }> {
  const filas = await filasDeLaMatriz(db);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, construirHoja(filas), HOJA);
  await fs.mkdir(salida, { recursive: true });
  const ruta = path.join(salida, `matriz-documental-${fechaBogota(ahora)}.xlsx`);
  await fs.writeFile(ruta, XLSX.write(libro, { type: "buffer", bookType: "xlsx" }));
  return { ruta, filas: filas.length };
}
