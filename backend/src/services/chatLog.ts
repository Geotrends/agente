import { createHash } from "node:crypto";
import { setting } from "./settings.js";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseCsvRows } from "../shared/csv.js";
import { maskPersonalData } from "./pii.js";
import { getProviderModel } from "../shared/providerModel.js";
import type { RoutedProvider } from "./providerRouter.js";

/**
 * Fuera del árbol de documentos (hallazgo A-11).
 *
 * Estaba en `backend/data/`, que es `GEOTRENDS_DOCUMENTS_ROOT` y, según el
 * README, el directorio que se sincroniza entre equipos: el registro de
 * conversaciones ciudadanas viajaba con el corpus a cualquiera que recibiera
 * una copia. `backend/var/` no se indexa, no se comparte y está en .gitignore.
 */
const defaultFile = new URL("chat-interactions.csv", new URL("../../var/", import.meta.url));
const legacyHeader = "ID_chat,LLM,Modelo,Pregunta,Respuesta,Fuentes\r\n";
/** Formato anterior a A-11: sin fecha (imposible aplicar retención) y sin hash. */
const legacyUndatedHeader = "ID_chat;LLM;Modelo;Prompt_version;Pregunta;Respuesta;Fuentes;Tiempo_respuesta_ms\r\n";
const header = "ID_chat;Fecha;LLM;Modelo;Prompt_version;Pregunta_hash;Pregunta;Respuesta;Fuentes;Tiempo_respuesta_ms\r\n";
const promptVersion = process.env.PROMPT_VERSION?.trim() || "1";
let lastId: number | undefined;
/** A qué archivo corresponde `lastId`: si la ruta cambia, el contador no vale. */
let lastIdFile: string | undefined;
let pending = Promise.resolve();

/**
 * Dónde se escribe el registro de interacciones.
 *
 * `CHAT_LOG_FILE` existe para que las pruebas no escriban en el CSV real. No es
 * cosmético: `scripts/extract-queries.ts` lee ese mismo archivo para construir
 * las preguntas del conjunto dorado, así que cada corrida de las pruebas de
 * integración metía sus respuestas de mentira ("Proyecto GEO-482...") en los
 * datos de evaluación. También es el primer paso hacia sacar el registro del
 * árbol que se comparte entre equipos, que es lo que pide A-11.
 */
function logFile(): URL {
  const override = process.env.CHAT_LOG_FILE?.trim();
  return override ? pathToFileURL(path.resolve(override)) : defaultFile;
}

/** Delimitador de un CSV ya escrito: el formato heredado usaba coma. */
function delimiterOf(csv: string): string {
  return csv.startsWith(legacyHeader) ? "," : ";";
}

/**
 * Agrupa preguntas idénticas sin conservar el original (A-11).
 *
 * Se hashea la pregunta ENMASCARADA, no la cruda: hashear el texto original
 * reintroduciría el dato por la puerta de atrás —con un diccionario de cédulas
 * se comprueba cuál corresponde a cada hash— y el propósito declarado del
 * campo (agrupar repeticiones para evaluación) se cumple igual sin eso.
 */
function questionHash(maskedQuestion: string): string {
  return createHash("sha256").update(maskedQuestion.trim().toLowerCase()).digest("hex").slice(0, 16);
}

/**
 * Cuántos días se conservan las interacciones. La Ley 1581 exige una finalidad
 * y un plazo, no "para siempre"; 90 días cubre de sobra el uso declarado, que
 * es evaluar la calidad de las respuestas.
 */
function retentionDays(): number {
  return setting('chatLogRetentionDays');
}

/**
 * Descarta las filas que superaron la retención. Devuelve el CSV tal cual si
 * no hay nada que purgar, para no reescribir 1 MB en cada arranque.
 *
 * Una fila sin fecha legible no se borra: son las heredadas del formato
 * anterior, y eliminarlas por no poder fecharlas sería destruir los datos de
 * evaluación por un defecto de formato nuestro. La migración les pone fecha,
 * así que el caso se extingue solo.
 */
export function purgeExpiredRows(csv: string, now = Date.now(), days = retentionDays()): string {
  if (!csv.startsWith(header)) return csv;
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const rows = parseCsvRows(csv, ";").slice(1);
  const kept = rows.filter(fields => {
    const stamp = Date.parse(fields[1] ?? "");
    return Number.isNaN(stamp) || stamp >= cutoff;
  });
  if (kept.length === rows.length) return csv;
  console.warn(`[chatlog] retención de ${days} días: se descartan ${rows.length - kept.length} interacciones.`);
  return header + kept.map(([id, ...rest]) => `${id};${rest.map(escapeCsv).join(";")}\r\n`).join("");
}

/**
 * Último id ya usado. Las respuestas del asistente llevan saltos de línea a
 * menudo, así que hay que respetar las comillas al separar filas — de eso se
 * encarga ahora el parser compartido (M-9), no una copia local.
 */
function readLastId(csv: string): number {
  if (!csv.trim()) return 0;
  let maximum = 0;
  for (const row of parseCsvRows(csv, delimiterOf(csv))) {
    const id = Number(row[0]);
    if (Number.isInteger(id)) maximum = Math.max(maximum, id);
  }
  return maximum;
}

function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}


/**
 * Lleva cualquier formato anterior al actual.
 *
 * Además de añadir columnas, **enmascara lo que ya estaba escrito** (A-11): el
 * archivo existente se acumuló sin ninguna protección, y dejarlo intacto
 * mientras se protege solo lo nuevo no resuelve nada — el riesgo vive en el
 * histórico, que es el grande.
 *
 * `stampedAt` fecha las filas heredadas, que no traían fecha. No es su fecha
 * real: es lo más temprano que se puede afirmar con certeza, y sin ella la
 * retención no tendría de dónde agarrarse.
 */
function migrateLegacyCsv(csv: string, stampedAt = new Date().toISOString()): string {
  const undated = csv.startsWith(legacyUndatedHeader);
  const delimiter = csv.startsWith(legacyHeader) ? "," : ";";
  const rows = parseCsvRows(csv, delimiter).slice(1);   // fuera la cabecera vieja
  return header + rows.map(fields => {
    // El formato sin fecha ya tenía Prompt_version y Tiempo_respuesta_ms; los
    // dos más viejos, no. De ahí los dos mapeos distintos.
    const [llm, modelo, version, pregunta, respuesta, fuentes, tiempo] = undated
      ? [fields[1], fields[2], fields[3], fields[4], fields[5], fields[6], fields[7]]
      : [fields[1], fields[2], "", fields[3], fields[4], fields[5], ""];
    const maskedQuestion = maskPersonalData(pregunta || "");
    const migrated = [
      stampedAt, llm || "", modelo || "", version || "",
      questionHash(maskedQuestion), maskedQuestion,
      maskPersonalData(respuesta || ""), fuentes || "", tiempo || "",
    ];
    // El id va sin comillas, igual que en la ruta de escritura normal: de otro
    // modo el mismo archivo mezcla `"1";` y `2;` según de dónde venga la fila.
    return `${fields[0] || ""};${migrated.map(escapeCsv).join(";")}\r\n`;
  }).join("");
}

export function logChatInteraction(input: {
  provider: RoutedProvider;
  model?: string;
  question: string;
  answer: string;
  sources: Array<{ path: string; title?: string; sourceUrl?: string }>;
  responseTimeMs: number;
}): Promise<void> {
  const model = input.model || getProviderModel(input.provider);
  const file = logFile();
  const directory = new URL(".", file);
  // La cadena `pending` serializa las escrituras entre sí, así que el orden
  // sigue garantizado aunque quien llama ya no espere el resultado (M-7).
  const write = pending.then(async () => {
    if (lastId === undefined || lastIdFile !== file.href) {
      await fs.mkdir(directory, { recursive: true });
      const existing = await fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      });
      if (!existing) await fs.writeFile(file, header, "utf8");
      else if (!existing.startsWith(header)) {
        // Cualquier formato anterior: se migra y, de paso, se enmascara.
        await fs.writeFile(file, purgeExpiredRows(migrateLegacyCsv(existing)), "utf8");
      } else {
        const purged = purgeExpiredRows(existing);
        if (purged !== existing) await fs.writeFile(file, purged, "utf8");
      }
      lastId = readLastId(existing);
      lastIdFile = file.href;
    }
    const id = lastId + 1;
    const sources = [...new Set(input.sources.map(source => {
      const label = source.title || source.path.split(/[\\/]/).pop() || source.path;
      return source.sourceUrl ? `${label} (${source.sourceUrl})` : label;
    }))].join("; ");
    // Enmascarar ANTES de tocar el disco: el texto crudo no llega a existir
    // fuera de memoria (A-11).
    const maskedQuestion = maskPersonalData(input.question);
    const fields = [
      new Date().toISOString(), input.provider, model, promptVersion,
      questionHash(maskedQuestion), maskedQuestion,
      maskPersonalData(input.answer), sources, String(input.responseTimeMs),
    ];
    await fs.appendFile(file, `${id};${fields.map(escapeCsv).join(";")}\r\n`, "utf8");
    lastId = id;
  });
  pending = write.catch(() => {});
  return write;
}
