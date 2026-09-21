/**
 * El único parser CSV del proyecto (hallazgo M-9).
 *
 * Había cinco escritos a mano —la auditoría contó dos y desde entonces
 * crecieron—: `sourceMetadata.ts` (coma, con BOM), `chatLog.ts` (punto y coma,
 * con detección del delimitador heredado), `scripts/lib/semicolonCsv.ts`,
 * `scripts/finalize-golden-set.ts` y `scripts/summarize-extraction-gaps.ts`.
 * Todos implementaban el mismo algoritmo con pequeñas diferencias de criterio,
 * sobre datos que produce este mismo proyecto — es decir, cinco sitios donde
 * podía aparecer el mismo bug de borde, y cuatro donde podía arreglarse a
 * medias.
 *
 * Comillas según RFC 4180: `""` dentro de un campo entrecomillado es una
 * comilla literal, y los saltos de línea dentro de comillas no terminan la
 * fila. Esto último importa de verdad aquí: las respuestas del asistente que se
 * guardan en `chat-interactions.csv` llevan saltos de línea a menudo.
 */

/** Filas crudas, sin interpretar la cabecera. */
export function parseCsvRows(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(field);
      // Una fila totalmente vacía es ruido de formato (línea en blanco al
      // final), no un registro: se descarta, que es lo que hacían las cinco.
      if (row.some(value => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some(value => value.length > 0)) rows.push(row);
  return rows;
}

/** Una sola fila, para cuando ya viene separada del resto. */
export function parseCsvRow(row: string, delimiter = ","): string[] {
  return parseCsvRows(row, delimiter)[0] ?? [];
}

/**
 * Registros con la cabecera como claves. El BOM que Excel escribe al inicio se
 * quita de la primera columna: si no, la clave queda con un carácter invisible
 * delante y ninguna búsqueda por nombre la encuentra.
 */
export function parseCsvRecords(text: string, delimiter = ","): Array<Record<string, string>> {
  if (!text.trim()) return [];
  const rows = parseCsvRows(text, delimiter);
  if (!rows.length) return [];
  const headers = rows[0].map((header, index) =>
    (index === 0 ? header.replace(/^﻿/, "") : header).trim()
  );
  return rows.slice(1).map(values => Object.fromEntries(
    headers.map((header, index) => [header, values[index] || ""])
  ));
}
