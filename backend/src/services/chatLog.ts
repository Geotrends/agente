import fs from "node:fs/promises";
import { getProviderModel } from "../shared/providerModel.js";
import type { RoutedProvider } from "./providerRouter.js";

const directory = new URL("../../data/", import.meta.url);
const file = new URL("chat-interactions.csv", directory);
const legacyHeader = "ID_chat,LLM,Modelo,Pregunta,Respuesta,Fuentes\r\n";
const header = "ID_chat,LLM,Modelo,Pregunta,Respuesta,Fuentes,Tiempo_respuesta_ms\r\n";
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
      const id = Number(csv.slice(rowStart, i).split(",", 1)[0]);
      if (Number.isInteger(id)) maximum = Math.max(maximum, id);
      rowStart = i + 1;
    }
  }
  return maximum;
}

function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

// Las interacciones anteriores conservan sus datos y dejan el tiempo vacío.
function migrateLegacyCsv(csv: string): string {
  let quoted = false;
  let result = header;
  for (let i = legacyHeader.length; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') quoted = !quoted;
    if (char === "\r" && csv[i + 1] === "\n" && !quoted) result += ",";
    result += char;
  }
  return result;
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
      else if (existing.startsWith(legacyHeader)) {
        await fs.writeFile(file, migrateLegacyCsv(existing), "utf8");
      }
      lastId = readLastId(existing);
    }
    const id = lastId + 1;
    const sources = [...new Set(input.sources.map(source => source.path.split(/[\\/]/).pop() || ""))].join("; ");
    const fields = [input.provider, model, input.question, input.answer, sources, String(input.responseTimeMs)];
    await fs.appendFile(file, `${id},${fields.map(escapeCsv).join(",")}\r\n`, "utf8");
    lastId = id;
  });
  pending = write.catch(() => {});
  return write;
}
