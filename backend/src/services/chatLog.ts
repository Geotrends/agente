import fs from "node:fs/promises";
import { getProviderModel } from "../shared/providerModel.js";
import type { RoutedProvider } from "./providerRouter.js";

const directory = new URL("../../data/", import.meta.url);
const file = new URL("chat-interactions.csv", directory);
const legacyHeader = "ID_chat,LLM,Modelo,Pregunta,Respuesta,Fuentes\r\n";
const legacySemicolonHeader = "ID_chat;LLM;Modelo;Pregunta;Respuesta;Fuentes\r\n";
const header = "ID_chat;LLM;Modelo;Prompt_version;Pregunta;Respuesta;Fuentes;Tiempo_respuesta_ms\r\n";
const promptVersion = process.env.PROMPT_VERSION?.trim() || "1";
let lastId: number | undefined;
let pending = Promise.resolve();

// Respeta saltos de línea dentro de campos CSV al recuperar el último ID.
function readLastId(csv: string): number {
  let quoted = false;
  let rowStart = 0;
  let maximum = 0;
  for (let i = 0; i < csv.length; i++) {
    if (csv[i] === '"') quoted = !quoted;
    if (csv[i] === "\n" && !quoted) {
      const row = csv.slice(rowStart, i);
      const delimiter = row.includes(";") ? ";" : ",";
      const id = Number(row.split(delimiter, 1)[0]);
      if (Number.isInteger(id)) maximum = Math.max(maximum, id);
      rowStart = i + 1;
    }
  }
  return maximum;
}

function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function parseCsvRow(row: string, delimiter: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (char === '"') {
      if (quoted && row[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

// Las interacciones anteriores conservan sus datos y dejan los nuevos campos vacíos.
function migrateLegacyCsv(csv: string): string {
  const delimiter = csv.startsWith(legacySemicolonHeader) ? ";" : ",";
  const sourceHeader = delimiter === ";" ? legacySemicolonHeader : legacyHeader;
  const rows: string[] = [];
  let quoted = false;
  let rowStart = sourceHeader.length;
  for (let i = sourceHeader.length; i < csv.length; i++) {
    if (csv[i] === '"') quoted = !quoted;
    if (csv[i] === "\n" && !quoted) {
      rows.push(csv.slice(rowStart, i).replace(/\r$/, ""));
      rowStart = i + 1;
    }
  }
  if (rowStart < csv.length) rows.push(csv.slice(rowStart));

  return header + rows.filter(Boolean).map(row => {
    const fields = parseCsvRow(row, delimiter);
    const migrated = [
      fields[0] || "",
      fields[1] || "",
      fields[2] || "",
      "",
      fields[3] || "",
      fields[4] || "",
      fields[5] || "",
      ""
    ];
    return migrated.map(escapeCsv).join(";") + "\r\n";
  }).join("");
}

export function logChatInteraction(input: {
  provider: RoutedProvider;
  question: string;
  answer: string;
  sources: Array<{ path: string }>;
  responseTimeMs: number;
}): Promise<void> {
  const model = getProviderModel(input.provider);
  const write = pending.then(async () => {
    if (lastId === undefined) {
      await fs.mkdir(directory, { recursive: true });
      const existing = await fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      });
      if (!existing) await fs.writeFile(file, header, "utf8");
      else if (existing.startsWith(legacyHeader) || existing.startsWith(legacySemicolonHeader)) {
        await fs.writeFile(file, migrateLegacyCsv(existing), "utf8");
      }
      lastId = readLastId(existing);
    }
    const id = lastId + 1;
    const sources = [...new Set(input.sources.map(source => source.path.split(/[\\/]/).pop() || ""))].join("; ");
    const fields = [input.provider, model, promptVersion, input.question, input.answer, sources, String(input.responseTimeMs)];
    await fs.appendFile(file, `${id};${fields.map(escapeCsv).join(";")}\r\n`, "utf8");
    lastId = id;
  });
  pending = write.catch(() => {});
  return write;
}
