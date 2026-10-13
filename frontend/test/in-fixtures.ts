/**
 * Fixtures de SPEC005 para las seis historias (RF-C4-IN-01/03, RNF-C4-IN-01).
 *
 * Reutiliza el host/iframe y los mocks de `helpers/api.ts` y añade tráfico observable SIN guardar
 * texto ciudadano: de cada petición solo se anotan modo, conteo de pares, si lleva identificador
 * y el tamaño del cuerpo. Todo resultado nace en entorno `emulado`: Chromium/Firefox/WebKit de
 * Playwright con la API simulada NO equivalen a nginx, Chrome Android ni Safari iOS reales.
 */
import type { BrowserContext, Page, Request } from "@playwright/test";
import { CHAT_ORIGIN, CONFIG, UUID, stubApi, type ApiLog } from "./helpers/api";

export { CHAT_ORIGIN, CONFIG, UUID };

export const ENTORNO = "emulado" as const;

/** Lo único que se conserva de cada consulta enviada. */
export type ChatTraffic = {
  n: number;
  conIdentificador: boolean;
  modo: "conversación" | "anónima";
  pares: number;
  conCategoria: boolean;
  bytes: number;
};

export type InLog = ApiLog & {
  traffic: ChatTraffic[];
  /** Cantidades de respuestas servidas por la API simulada, sin contenido. */
  served: { chats: number };
};

type AnswerFactory = NonNullable<Parameters<typeof stubApi>[1]>["answer"];

/** Instala la API simulada y deriva el tráfico observable (sin texto) de cada consulta. */
export async function stubInApi(
  context: BrowserContext,
  opts: { answer?: AnswerFactory; rating?: NonNullable<Parameters<typeof stubApi>[1]>["rating"] } = {},
): Promise<InLog> {
  const traffic: ChatTraffic[] = [];
  const served = { chats: 0 };
  const log = await stubApi(context, {
    rating: opts.rating,
    answer: (n, body) => {
      const historial = Array.isArray(body.historial) ? body.historial : [];
      traffic.push({
        n,
        conIdentificador: typeof body.conversationId === "string",
        modo: typeof body.conversationId === "string" ? "conversación" : "anónima",
        pares: historial.length,
        conCategoria: typeof body.categoria === "string",
        bytes: JSON.stringify(body).length,
      });
      served.chats++;
      return opts.answer?.(n, body) ?? {};
    },
  });
  return Object.assign(log, { traffic, served });
}

/** Vuelca localStorage, sessionStorage, cookies, URL e IndexedDB del frame del chat. */
export async function storageDump(page: Page): Promise<{ dump: string; indexedDbCount: number }> {
  return page.evaluate(async () => ({
    dump: JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, c: document.cookie, u: location.href }),
    indexedDbCount: (await indexedDB.databases?.())?.length ?? 0,
  }));
}

/** Comprueba que ningún valor sensible aparece en el volcado; devuelve los hallazgos (vacío = limpio). */
export function leaks(dump: string, secretos: string[]): string[] {
  return secretos.filter(s => dump.includes(s));
}

/** Cuenta solicitudes salientes del navegador a una ruta de la API del chat, sin leer su contenido. */
export function countRequests(page: Page, pathSuffix: string): { count: () => number; dispose: () => void } {
  let n = 0;
  const handler = (r: Request) => { if (r.url().startsWith(CHAT_ORIGIN) && new URL(r.url()).pathname.endsWith(pathSuffix)) n++; };
  page.on("request", handler);
  return { count: () => n, dispose: () => page.off("request", handler) };
}
