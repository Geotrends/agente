/**
 * El CSV de `data/chat-interactions.csv` usa ";" como delimitador. El parser
 * vive ahora en `src/shared/csv.ts`, uno solo para todo el proyecto (M-9);
 * esto queda como el nombre con el que ya lo llamaban los scripts.
 */
import { parseCsvRecords } from "../../src/shared/csv.js";

export function parseSemicolonCsv(text: string): Array<Record<string, string>> {
  return parseCsvRecords(text, ";");
}
