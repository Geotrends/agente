/**
 * T017 — Continuidad y decisión de datos en navegador (RF-C4-IN-01/02, RNF-C4-IN-01).
 *
 * C401: seis recorridos (autorización con un ID, anónimo sin ID, nueva conversación y recarga con
 * IDs distintos, creación fallida, doble clic). C402: tres recorridos de historial (doce turnos
 * autorizados con 10 pares en el 12.º, anónimo, fallo fuera de historial y expiración sin replay).
 * API simulada, sin storage ni IDs de frontend. Entorno `emulado`: no equivale a nginx ni a
 * dispositivos reales.
 */
import { expect, test, type Page } from "@playwright/test";
import { CHAT_ORIGIN, leaks, stubInApi, storageDump, type InLog } from "./in-fixtures";

const toggle = (page: Page) => page.locator("button.geobot-w-btn");
const FALLO = "En este momento no puedo responder. Puede intentarlo de nuevo o comunicarse por los canales oficiales.";
const hex = (n: number) => n.toString(16).padStart(12, "0");
const uuid = (n: number) => `00000000-0000-4000-8000-${hex(n)}`;

/** Secuencia de UUID v4 distintos por cada creación de conversación (el backend los emite). */
async function conversationIds(page: Page, opts: { failFirst?: number; delayMs?: number } = {}) {
  const seen: string[] = [];
  let calls = 0;
  await page.route(`${CHAT_ORIGIN}/api/conversations`, async r => {
    calls++;
    if (opts.delayMs) await new Promise(res => setTimeout(res, opts.delayMs));
    if (calls <= (opts.failFirst ?? 0)) return r.fulfill({ status: 503, json: { error: { codigo: "SERVICIO_NO_DISPONIBLE", mensaje: "x" }, canales: [] } });
    const id = uuid(seen.length + 1);
    seen.push(id);
    return r.fulfill({ status: 201, json: { modo: "conversación", conversationId: id } });
  });
  return { seen, calls: () => calls };
}

async function open(page: Page) {
  await page.goto("/observatorio");
  await toggle(page).click();
  return page.frameLocator("iframe");
}

async function ask(f: ReturnType<Page["frameLocator"]>, text: string, expected: string | RegExp) {
  await f.getByLabel("Pregunta").fill(text);
  await f.getByRole("button", { name: "Enviar" }).click();
  await expect(f.getByText(expected).first()).toBeVisible();
}

async function frameStorage(page: Page) {
  const frame = page.frames().find(fr => fr.url().startsWith(CHAT_ORIGIN));
  if (!frame) throw new Error("sin frame del chat");
  return frame.evaluate(async () => ({
    dump: JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, c: document.cookie, u: location.href }),
    dbs: (await indexedDB.databases?.())?.length ?? 0,
  }));
}

const answerFor = (n: number, id?: string) => id
  ? { modo: "conversación", conversationId: id, responseId: `r${n}`, tipo: "respondida", respuesta: `Respuesta ${n}`, fuentes: [] }
  : { modo: "anónima", tipo: "respondida", respuesta: `Respuesta ${n}`, fuentes: [] };

test.describe("C401 · seis recorridos de identidad", () => {
  test("1 · «Autorizo»: un identificador del backend y consultas con él", async ({ page, context }) => {
    const ids = await conversationIds(page);
    const log: InLog = await stubInApi(context, { answer: (n, b) => ({ json: answerFor(n, b.conversationId as string) }) });
    const f = await open(page);
    await f.getByRole("button", { name: "Autorizo", exact: true }).click();
    await f.getByRole("button", { name: "No estoy seguro" }).click();
    await ask(f, "primera consulta", "Respuesta 1");
    expect(ids.seen).toHaveLength(1);
    expect(log.traffic).toEqual([expect.objectContaining({ conIdentificador: true, modo: "conversación", pares: 0 })]);
    const chat = log.chats[0] as { conversationId: string };
    expect(chat.conversationId).toBe(ids.seen[0]);
  });

  test("2 · «No autorizo»: ningún identificador ni creación de conversación", async ({ page, context }) => {
    const ids = await conversationIds(page);
    const log = await stubInApi(context, { answer: n => ({ json: answerFor(n) }) });
    const f = await open(page);
    await f.getByRole("button", { name: "No autorizo", exact: true }).click();
    await f.getByRole("button", { name: "No estoy seguro" }).click();
    await ask(f, "consulta anónima", "Respuesta 1");
    expect(ids.calls()).toBe(0);
    expect(log.traffic[0]).toMatchObject({ conIdentificador: false, modo: "anónima", pares: 0 });
  });

  test("3 · nueva conversación: identificador distinto, sin historial ni contexto previo", async ({ page, context }) => {
    const ids = await conversationIds(page);
    const log = await stubInApi(context, { answer: (n, b) => ({ json: answerFor(n, b.conversationId as string) }) });
    const f = await open(page);
    await f.getByRole("button", { name: "Autorizo", exact: true }).click();
    await f.getByRole("button", { name: "No estoy seguro" }).click();
    await ask(f, "antes del reinicio", "Respuesta 1");
    await f.getByRole("button", { name: "Nueva conversación" }).click();
    await f.getByRole("button", { name: "Iniciar nueva" }).click();
    await f.getByRole("button", { name: "Autorizo", exact: true }).click();
    await f.getByRole("button", { name: "No estoy seguro" }).click();
    await ask(f, "después del reinicio", "Respuesta 2");
    expect(ids.seen).toHaveLength(2);
    expect(ids.seen[0]).not.toBe(ids.seen[1]);
    expect(log.traffic[1]).toMatchObject({ conIdentificador: true, pares: 0 });
    expect((log.chats[1] as { conversationId: string }).conversationId).toBe(ids.seen[1]);
  });

  test("4 · recargar destruye el estado: decisión pendiente, sin storage y nuevo identificador", async ({ page, context }) => {
    const ids = await conversationIds(page);
    await stubInApi(context, { answer: (n, b) => ({ json: answerFor(n, b.conversationId as string) }) });
    let f = await open(page);
    await f.getByRole("button", { name: "Autorizo", exact: true }).click();
    await f.getByRole("button", { name: "No estoy seguro" }).click();
    await ask(f, "consulta confidencial uno", "Respuesta 1");
    const s = await frameStorage(page);
    expect(leaks(s.dump, [ids.seen[0], "consulta confidencial", "tok-tecnico"])).toEqual([]);
    expect(s.dbs).toBe(0);

    await page.reload();
    await toggle(page).click();
    f = page.frameLocator("iframe");
    await expect(f.getByRole("button", { name: "Autorizo", exact: true })).toBeVisible();
    await expect(f.getByLabel("Pregunta")).toBeDisabled();
    await f.getByRole("button", { name: "Autorizo", exact: true }).click();
    await f.getByRole("button", { name: "No estoy seguro" }).click();
    await ask(f, "consulta confidencial dos", "Respuesta 2");
    expect(ids.seen).toHaveLength(2);
    expect(ids.seen[0]).not.toBe(ids.seen[1]);
  });

  test("5 · creación fallida: no hay consulta posible hasta autorizar de nuevo", async ({ page, context }) => {
    const ids = await conversationIds(page, { failFirst: 1 });
    const log = await stubInApi(context, { answer: (n, b) => ({ json: answerFor(n, b.conversationId as string) }) });
    const f = await open(page);
    await f.getByRole("button", { name: "Autorizo", exact: true }).click();
    await expect(f.getByText(/No fue posible iniciar la conversación/)).toBeVisible();
    await expect(f.getByLabel("Pregunta")).toBeDisabled();
    expect(log.chats).toHaveLength(0);
    await f.getByRole("button", { name: "Autorizo", exact: true }).click();
    await f.getByRole("button", { name: "No estoy seguro" }).click();
    await ask(f, "ahora sí", "Respuesta 1");
    expect(ids.calls()).toBe(2);
    expect(ids.seen).toHaveLength(1);
  });

  test("6 · doble clic en «Autorizo»: una sola conversación creada", async ({ page, context }) => {
    const ids = await conversationIds(page, { delayMs: 400 });
    await stubInApi(context, { answer: (n, b) => ({ json: answerFor(n, b.conversationId as string) }) });
    const f = await open(page);
    const boton = f.getByRole("button", { name: "Autorizo", exact: true });
    await boton.dblclick({ force: true }).catch(() => {});
    await f.getByRole("button", { name: "No estoy seguro" }).click();
    expect(ids.calls()).toBe(1);
    expect(ids.seen).toHaveLength(1);
  });
});

test.describe("C402 · historial y expiración", () => {
  test("1 · doce turnos autorizados: 0,1,…,10,10 pares y cronología correcta", async ({ page, context }) => {
    const ids = await conversationIds(page);
    const log = await stubInApi(context, { answer: (n, b) => ({ json: answerFor(n, b.conversationId as string) }) });
    const f = await open(page);
    await f.getByRole("button", { name: "Autorizo", exact: true }).click();
    await f.getByRole("button", { name: "No estoy seguro" }).click();
    for (let n = 1; n <= 12; n++) await ask(f, `turno ${n}`, `Respuesta ${n}`);
    expect(log.traffic.map(t => t.pares)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10]);
    const ultimo = log.chats[11] as { historial: Array<{ pregunta: string; respuesta: string }>; conversationId: string };
    expect(ultimo.historial).toHaveLength(10);
    expect(ultimo.historial[0]).toEqual({ pregunta: "turno 2", respuesta: "Respuesta 2" });
    expect(ultimo.historial[9]).toEqual({ pregunta: "turno 11", respuesta: "Respuesta 11" });
    expect(ultimo.conversationId).toBe(ids.seen[0]);
  });

  test("2 · anónimo: cuatro turnos sin historial ni identificador, con transcripción visible", async ({ page, context }) => {
    await conversationIds(page);
    const log = await stubInApi(context, { answer: n => ({ json: answerFor(n) }) });
    const f = await open(page);
    await f.getByRole("button", { name: "No autorizo", exact: true }).click();
    await f.getByRole("button", { name: "No estoy seguro" }).click();
    for (let n = 1; n <= 4; n++) await ask(f, `anónima ${n}`, `Respuesta ${n}`);
    expect(log.traffic.every(t => t.pares === 0 && !t.conIdentificador)).toBe(true);
    await expect(f.getByText("anónima 1")).toBeVisible();
  });

  test("3 · un fallo queda fuera del historial y una sesión expirada no se repite ni se reasocia", async ({ page, context }) => {
    await conversationIds(page);
    let sessions = 0;
    const log = await stubInApi(context, {
      answer: (n, b) => {
        if (n === 3) return { status: 500, json: { error: { codigo: "ERROR_INTERNO", mensaje: "x" }, canales: [] } };
        if (n === 5) return { status: 401, json: { error: { codigo: "NO_AUTORIZADO", mensaje: "x" }, canales: [] } };
        return { json: answerFor(n, b.conversationId as string) };
      },
    });
    await page.route(`${CHAT_ORIGIN}/api/session`, r => { sessions++; return r.fulfill({ json: { token: `tok-${sessions}`, expiresIn: 3600 } }); });
    const f = await open(page);
    await f.getByRole("button", { name: "Autorizo", exact: true }).click();
    await f.getByRole("button", { name: "No estoy seguro" }).click();
    await ask(f, "turno 1", "Respuesta 1");
    await ask(f, "turno 2", "Respuesta 2");
    // Turno 3 falla (500): ocurre 1 vez y no entra al historial.
    await f.getByLabel("Pregunta").fill("turno 3 falla");
    await f.getByRole("button", { name: "Enviar" }).click();
    await expect(f.getByRole("alert", { name: /No fue posible responder/ })).toContainText(FALLO);
    // Turno 4 (n=4 en la API): historial con solo los 2 pares válidos.
    await ask(f, "turno 4", "Respuesta 4");
    expect(log.traffic[3].pares).toBe(2);
    expect(JSON.stringify(log.chats[3])).not.toContain("turno 3 falla");
    // Turno 5: la sesión expiró (401). No se repite, no se pide otro token y se bloquea nuevas consultas.
    const sesionesAntes = sessions;
    await f.getByLabel("Pregunta").fill("turno 5 expira");
    await f.getByRole("button", { name: "Enviar" }).click();
    await expect(f.getByRole("alert", { name: /No fue posible responder/ })).toContainText("Nueva conversación");
    await expect(f.getByLabel("Pregunta")).toBeDisabled();
    expect(log.chats).toHaveLength(5);
    expect(sessions).toBe(sesionesAntes);
  });
});
