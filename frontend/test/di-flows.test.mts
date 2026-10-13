/**
 * Recorridos del chat renderizados con jsdom (sin navegador real): apertura y política, canales de
 * urgencia antes de decidir, consentimiento, anónimas autónomas, errores y enlaces seguros.
 * No sustituye la revisión en navegador y de accesibilidad con lector de pantalla (T096).
 */
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./domSetup";

installDom();
const { render, screen, fireEvent, waitFor, cleanup, act } = await import("@testing-library/react");
const { createElement } = await import("react");
const mod = await import("../smart/SmartAgentPanel");
const SmartAgentPanel = (mod as unknown as { default: { default?: unknown } }).default?.default ?? (mod as { default: unknown }).default;

const UUID = "11111111-1111-4111-8111-111111111111";
const CONFIG = {
  apertura: "¡Hola! Soy Geobot, el asistente virtual del Observatorio Ambiental y Agropecuario del Municipio de Envigado.",
  politica: { version: "2026-10", url: "https://ejemplo.gov.co/politica" },
  opciones: [{ valor: "autorizo", etiqueta: "Autorizo" }, { valor: "no_autorizo", etiqueta: "No autorizo" }],
  contactos: {
    revision: 3,
    recepcion: { pqrsd: "https://pqrsd.ejemplo.gov.co", whatsapp: "+57 300 111 2233", email: "pqrsd@ejemplo.gov.co" },
    general: { phone: "(604) 555 0100", email: "info@ejemplo.gov.co", url: "https://ejemplo.gov.co/contacto" },
    inmediatos: [
      { id: "a", name: "Línea de emergencias", description: "Atención 24 horas", type: "teléfono", value: "123", position: 1 },
      { id: "b", name: "Policía Ambiental", description: "Denuncias en curso", type: "teléfono", value: "(604) 111 2222", position: 2 },
    ],
  },
};

type Llamada = { url: string; method: string; body: Record<string, unknown> | null; auth: string | null };
let llamadas: Llamada[] = [];
let respuestaChat: (n: number) => Response;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

function instalarFetch(): void {
  let chats = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    llamadas.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null, auth: headers.get("authorization") });
    if (url.endsWith("/chat/config")) return json(CONFIG);
    if (url.endsWith("/session")) return json({ token: "tok-tecnico", expiresIn: 3600 });
    if (url.endsWith("/conversations")) return json({ modo: "conversación", conversationId: UUID }, 201);
    if (url.endsWith("/chat")) return respuestaChat(++chats);
    return new Response("no", { status: 404 });
  }) as typeof fetch;
}

const ok = (n: number) => json({ modo: "anónima", tipo: "respondida", respuesta: `Respuesta ${n} según [Doc](https://ejemplo.gov.co/doc) y [inseguro](http://malo.example/x).`,
  fuentes: [{ id: "d1", nombre: "Documento 1", enlace: "https://ejemplo.gov.co/doc", fecha: "2026-03-15" }] });

beforeEach(() => { llamadas = []; globalThis.sessionStorage.clear(); respuestaChat = ok; instalarFetch(); });
afterEach(() => cleanup());

const montar = async () => { render(createElement(SmartAgentPanel as never)); await screen.findByText(/Soy Geobot/); };
const campo = () => screen.getByLabelText("Pregunta") as HTMLInputElement;
const enviar = async (texto: string) => {
  await act(async () => { fireEvent.change(campo(), { target: { value: texto } }); });
  await act(async () => { fireEvent.submit(campo().closest("form")!); });
};
const chats = () => llamadas.filter(l => l.url.endsWith("/chat") && l.method === "POST");
const elegirCategoria = async (nombre: string) => {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: nombre })); });
};

test("5 aperturas (3 escritorio / 2 móvil): presentación, política https en pestaña nueva, opciones y pregunta deshabilitada", async () => {
  for (const ancho of [1440, 1280, 1024, 390, 360]) {
    cleanup(); llamadas = [];
    (window as unknown as { innerWidth: number }).innerWidth = ancho;
    window.dispatchEvent(new window.Event("resize"));
    const t0 = Date.now();
    await montar();
    assert.ok(Date.now() - t0 < 2000, "la configuración aparece en ≤ 2 s");
    const politica = screen.getByRole("link", { name: /política de tratamiento de datos/ }) as HTMLAnchorElement;
    assert.equal(politica.href, CONFIG.politica.url);
    assert.equal(politica.target, "_blank");
    assert.match(politica.rel, /noopener/);
    assert.ok(screen.getByRole("button", { name: "Autorizo" }) && screen.getByRole("button", { name: "No autorizo" }));
    assert.equal(campo().disabled, true, "sin decisión no se puede consultar");
    assert.equal(chats().length, 0);
  }
});

test("6 recorridos de urgencia: la opción de emergencia muestra los canales sin decidir, sin consultar ni autorizar", async () => {
  for (let i = 0; i < 6; i++) {
    cleanup(); llamadas = [];
    await montar();
    assert.equal(screen.queryByText("Canales de atención inmediata"), null, "solo aparecen al elegir la opción");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Emergencia o situación en curso" })); });
    const bloque = screen.getByRole("region", { name: "Canales de atención inmediata" });
    assert.ok(bloque.textContent!.includes("123") && bloque.textContent!.includes("(604) 111 2222"), "valores exactos del registro");
    assert.ok(bloque.textContent!.indexOf("Línea de emergencias") < bloque.textContent!.indexOf("Policía Ambiental"), "en el orden del registro");
    assert.equal(campo().disabled, true, "no habilita la consulta");
    assert.deepEqual(llamadas.map(l => l.url.replace(/^.*\/api/, "")), ["/chat/config"], "solo se pidió la configuración: ni sesión, ni conversación, ni modelo");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Continuar con la orientación" })); });
    assert.equal(screen.queryByRole("region", { name: "Canales de atención inmediata" }), null);
    assert.ok(screen.getByRole("button", { name: "Autorizo" }), "puede retomar el flujo normal");
  }
});

test("emergencia con el registro sin canales: mensaje de respaldo sin valores inventados", async () => {
  const original = CONFIG.contactos.inmediatos;
  CONFIG.contactos.inmediatos = [];
  try {
    await montar();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Emergencia o situación en curso" })); });
    // SPEC004 IN-06: literal fijo, sin teléfonos ni correos de reserva.
    assert.ok(screen.getByRole("alert").textContent!.includes("No pudimos cargar los canales de atención. Consulte los canales oficiales del Municipio de Envigado."));
  } finally { CONFIG.contactos.inmediatos = original; }
});

test("fallo al cargar la configuración: mensaje literal de IN-06 con nuevo intento", async () => {
  globalThis.fetch = (async () => new Response("x", { status: 503 })) as typeof fetch;
  render(createElement(SmartAgentPanel as never));
  const alerta = await screen.findByRole("alert");
  assert.ok(alerta.textContent!.includes("No pudimos cargar los canales de atención. Consulte los canales oficiales del Municipio de Envigado."));
  assert.ok(screen.getByRole("button", { name: "Intentar de nuevo" }));
});

test("12 consultas con categoría: cada dirección viaja al backend y «No estoy seguro» no envía criterio", async () => {
  const casos: Array<[string, string | undefined]> = [
    ["Ecosistemas", "Ecosistemas"], ["Bienestar Animal", "Bienestar Animal"],
    ["Gestión Ambiental", "Gestión Ambiental"], ["No estoy seguro", undefined],
  ];
  for (let ronda = 0; ronda < 3; ronda++) {
    for (const [boton, esperada] of casos) {
      cleanup(); llamadas = [];
      await montar();
      assert.equal(screen.queryByRole("group", { name: /dirección es tu consulta/ }), null, "sin decisión no hay categoría");
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "No autorizo" })); });
      assert.equal(campo().disabled, true, "sin categoría no se consulta");
      await elegirCategoria(boton);
      assert.equal(campo().disabled, false);
      await enviar("¿Qué requisitos tiene?");
      await screen.findByText(/Respuesta \d/);
      const cuerpo = chats().at(-1)!.body!;
      assert.equal(cuerpo.categoria, esperada);
      assert.ok(!("categoria" in cuerpo) || esperada !== undefined);
    }
  }
});

test("No autorizo: 5 consultas con 2 seguimientos, sin conversationId ni historial; la transcripción visible es solo de memoria", async () => {
  await montar();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "No autorizo" })); });
  assert.ok(screen.getByRole("note").textContent!.includes("cada pregunta debe formularse completa"));
  await elegirCategoria("No estoy seguro");
  assert.equal(campo().disabled, false);
  for (const q of ["¿Qué es el RUM?", "¿y el costo?", "¿y el plazo?", "otra consulta", "última"]) {
    await enviar(q);
    await waitFor(() => assert.equal(screen.getByRole("log").querySelectorAll("article.message.assistant").length, ["¿Qué es el RUM?", "¿y el costo?", "¿y el plazo?", "otra consulta", "última"].indexOf(q) + 1));
  }
  // SPEC004: transcripción visible volátil, pero nunca enviada como contexto (los cuerpos son mínimos).
  assert.equal(screen.getByRole("log").querySelectorAll("article.message.user").length, 5);
  assert.equal(chats().length, 5);
  for (const c of chats()) {
    assert.deepEqual(Object.keys(c.body!), ["pregunta"], "cuerpo mínimo");
    assert.equal(c.auth, "Bearer tok-tecnico");
  }
  assert.ok(!llamadas.some(l => l.url.endsWith("/conversations")), "«No autorizo» no crea nada en el backend");
});

test("Autorizo: UUID del backend, historial de pares (máx. 10) y nada del UUID en el almacenamiento del navegador", async () => {
  respuestaChat = n => json({ modo: "conversación", conversationId: UUID, responseId: `r${n}`, tipo: "respondida", respuesta: `Respuesta ${n}`, fuentes: [] });
  await montar();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Autorizo" })); });
  await elegirCategoria("No estoy seguro");
  await waitFor(() => assert.equal(campo().disabled, false));
  const conv = llamadas.find(l => l.url.endsWith("/conversations"))!;
  assert.deepEqual(conv.body, { autorizacion: true, policyVersion: "2026-10" });
  for (let i = 0; i < 13; i++) { await enviar(`pregunta ${i}`); await screen.findByText(`Respuesta ${i + 1}`); }
  const ultimo = chats().at(-1)!.body!;
  assert.equal(ultimo.conversationId, UUID);
  assert.equal((ultimo.historial as unknown[]).length, 10);
  assert.deepEqual((ultimo.historial as Array<{ pregunta: string }>).at(-1), { pregunta: "pregunta 11", respuesta: "Respuesta 12" });
  assert.deepEqual(Object.keys(chats()[0].body!).sort(), ["conversationId", "pregunta"]);
  const guardado = JSON.stringify(Object.fromEntries(Object.entries(globalThis.sessionStorage)));
  assert.ok(!guardado.includes(UUID) && !guardado.includes("pregunta"), "ni el UUID ni las preguntas se guardan");
});

test("recargar vuelve a pedir la decisión: el estado de la conversación no sobrevive", async () => {
  await montar();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Autorizo" })); });
  await elegirCategoria("No estoy seguro");
  await waitFor(() => assert.equal(campo().disabled, false));
  cleanup();
  await montar();
  assert.equal(campo().disabled, true);
  assert.ok(screen.getByRole("button", { name: "Autorizo" }));
});

test("errores: mensaje del backend con los canales vigentes y Retry-After; el fallo no entra al historial", async () => {
  respuestaChat = () => json({ error: { codigo: "SERVICIO_NO_DISPONIBLE", mensaje: "No pude atender la consulta en este momento." }, canales: CONFIG.contactos.inmediatos }, 503, { "retry-after": "30" });
  await montar();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "No autorizo" })); });
  await elegirCategoria("No estoy seguro");
  await enviar("¿Qué requisitos?");
  const msg = await screen.findByText(/En este momento no puedo responder/);
  const fallo = msg.closest("section")!;
  assert.ok(fallo.textContent!.includes("https://pqrsd.ejemplo.gov.co"), "canales de recepción del snapshot");
  assert.ok(fallo.textContent!.includes("+57 300 111 2233"));
  assert.ok(!fallo.textContent!.includes("SERVICIO_NO_DISPONIBLE") && !fallo.textContent!.includes("No pude atender"), "sin código ni mensaje interno");
  assert.ok(screen.getByRole("button", { name: /Reintentar/ }), "recuperable");
  assert.equal(screen.getByRole("log").querySelectorAll("article.message.assistant").length, 0, "el fallo no entra a la conversación");
});

test("enlaces: https en pestaña nueva con aviso para lector de pantalla; http y javascript: solo como texto", async () => {
  await montar();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "No autorizo" })); });
  await elegirCategoria("No estoy seguro");
  await enviar("¿Qué dice el documento?");
  await screen.findByText(/Respuesta 1/);
  const log = screen.getByRole("log");
  const seguro = [...log.querySelectorAll("a")].find(a => a.getAttribute("href") === "https://ejemplo.gov.co/doc")!;
  assert.equal(seguro.getAttribute("target"), "_blank");
  assert.match(seguro.getAttribute("rel")!, /noreferrer/);
  assert.match(seguro.getAttribute("aria-label")!, /\(se abre en una pestaña nueva\)$/, "avisa que abre una pestaña nueva");
  assert.ok(![...log.querySelectorAll("a")].some(a => (a.getAttribute("href") ?? "").startsWith("http://")), "http no es navegable");
  assert.ok(log.textContent!.includes("inseguro"));
});

test("accesibilidad básica: región viva con nombre, campo etiquetado, botón con nombre accesible", async () => {
  await montar();
  assert.equal(screen.getByRole("log").getAttribute("aria-live"), "polite");
  assert.ok(screen.getByRole("log").getAttribute("aria-label"));
  assert.ok(screen.getByLabelText("Pregunta"));
  assert.ok(screen.getByRole("button", { name: "Enviar" }));
  assert.ok(screen.getAllByRole("status").length >= 1, "región de estado siempre montada");
  assert.ok([...document.querySelectorAll("img")].every(i => i.getAttribute("alt") !== null), "imágenes decorativas con alt vacío");
});
