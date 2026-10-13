import test from "node:test";
import assert from "node:assert/strict";
import { orchestrate, type OrchestratorDeps } from "../src/chat/orchestrator.js";
import type { ModelCallResult, PreguntaValidada } from "../src/chat/contracts.js";
import { CONTACTOS, hit } from "./di-support.js";

const q = (pregunta: string): PreguntaValidada => ({ pregunta, historial: [] });
const usage = { inputTokens: 1, outputTokens: 1 };
const reply = (text: string): ModelCallResult => ({ text, usage, stopReason: "end_turn", effectiveModel: "m" });

function deps(text: string, over: Partial<OrchestratorDeps> = {}): OrchestratorDeps & { calls: { retrieve: number; model: number } } {
  const calls = { retrieve: 0, model: 0 };
  return {
    calls,
    retrieve: async () => { calls.retrieve++; return { hits: [hit(1)] }; },
    contacts: async () => CONTACTOS,
    model: async () => { calls.model++; return reply(text); },
    ...over,
  };
}

const ANALISIS = [
  "Haz una regresión lineal con los datos de arborización del municipio",
  "Calcula el promedio de mascotas registradas por año",
  "Predice cuántos perros habrá en 2030",
  "¿Cuál es la correlación estadística entre tala y lluvias?",
  "Calcula la desviación estándar de las visitas técnicas",
];
const TRAMITES = [
  "¿Cómo registro a mi mascota en el RUM?", "¿Qué requisitos tiene la licencia ambiental?", "¿Cómo solicito una visita de arbolado?",
  "¿Dónde presento una denuncia por maltrato animal?", "¿Cómo adopto una mascota del municipio?",
];

test("DI-01: 5 de análisis se rechazan sin cálculo, sin recuperar ni llamar al modelo y con contacto oficial; 5 trámites siguen normal", async () => {
  for (const pregunta of ANALISIS) {
    const d = deps("x");
    const out = await orchestrate(q(pregunta), d);
    assert.equal(out.tipo, "fuera de alcance");
    assert.deepEqual(out.fuentes, []);
    assert.ok(out.respuesta.includes(CONTACTOS.general.phone) && out.respuesta.includes(CONTACTOS.general.email));
    assert.equal(d.calls.model + d.calls.retrieve, 0);
    assert.ok(!/\d+\s*(\.|,)\s*\d+/.test(out.respuesta), "sin cifras calculadas");
  }
  for (const pregunta of TRAMITES) {
    const out = await orchestrate(q(pregunta), deps("Pasos del trámite [D1].\n<!--FUENTES: D1-->\n<!--TIPO: respondida-->"));
    assert.equal(out.tipo, "respondida");
  }
});

const AJENAS_LOCALES = ["Dame una receta de sancocho", "¿Quién ganó el partido de fútbol?", "Escríbeme un poema sobre el mar", "Necesito un diagnóstico médico de mi tos"];
const AJENAS_MODELO = ["¿Cuál es la capital de Francia?", "Explícame la teoría de la relatividad", "¿Cómo declaro renta en la DIAN?", "Cuéntame un chiste"];
const PROPIAS = ["¿Qué hago con un perro abandonado?", "¿Cómo reporto una tala ilegal?", "¿Cómo registro mi mascota?", "¿Cómo pido un permiso de poda?"];

test("DI-20: 4 ajenas dan las tres direcciones + contacto general sin contestar la materia; 4 propias normales", async () => {
  const vistas: string[] = [];
  for (const pregunta of AJENAS_LOCALES) vistas.push((await orchestrate(q(pregunta), deps("x"))).respuesta);
  for (const pregunta of AJENAS_MODELO) {
    const out = await orchestrate(q(pregunta), deps("París es la capital.\n<!--FUENTES:-->\n<!--TIPO: fuera_de_alcance-->"));
    assert.equal(out.tipo, "fuera de alcance");
    vistas.push(out.respuesta);
  }
  for (const r of vistas) {
    for (const d of ["Ecosistemas", "Bienestar Animal", "Gestión Ambiental"]) assert.ok(r.includes(d), d);
    assert.ok(r.includes(CONTACTOS.general.phone));
    assert.ok(!r.includes("París"), "no contesta la materia");
  }
  for (const pregunta of PROPIAS) {
    assert.equal((await orchestrate(q(pregunta), deps("Respuesta [D1].\n<!--FUENTES: D1-->"))).tipo, "respondida");
  }
});

const INSUFICIENTES = ["necesito un permiso", "tengo un problema con un animal", "quiero hacer un trámite", "una pregunta sobre el árbol"];
const COMPLETAS = ["¿Qué requisitos tiene el RUM para un perro adulto?", "¿Cómo solicito poda de un árbol en espacio público?", "¿Qué documentos pide la adopción de un gato?", "¿Dónde radico una queja por ruido de un criadero?"];

test("DI-21: aclaración única en conversación autorizada (≥3/4), ninguna en completas, segunda insuficiente → DI-04 y se limpia el estado", async () => {
  let aclaradas = 0;
  for (const pregunta of INSUFICIENTES) {
    const out = await orchestrate(q(pregunta), deps("¿Qué tipo de permiso necesita y para qué predio?\n<!--TIPO: aclaracion-->"), { autorizada: true, aclaracionPendiente: false });
    if (out.tipo === "aclaración") {
      aclaradas++;
      assert.equal(out.aclaracionPendiente, true);
      assert.deepEqual(out.fuentes, []);
      assert.equal(out.respuesta.split("?").length - 1, 1, "una sola pregunta");
    }
  }
  assert.ok(aclaradas >= 3);
  for (const pregunta of COMPLETAS) {
    const out = await orchestrate(q(pregunta), deps("Respuesta [D1].\n<!--FUENTES: D1-->\n<!--TIPO: respondida-->"), { autorizada: true, aclaracionPendiente: false });
    assert.notEqual(out.tipo, "aclaración");
  }
  // La segunda insuficiente tras una aclaración termina con el texto de ausencia y limpia el estado.
  const segunda = await orchestrate(q("sigue sin ser claro"), deps("¿Puede darme más detalle?\n<!--TIPO: aclaracion-->"), { autorizada: true, aclaracionPendiente: true });
  assert.equal(segunda.tipo, "sin información");
  assert.ok(segunda.respuesta.startsWith("No encontré información validada…"));
  assert.equal(segunda.aclaracionPendiente, false);
  // Una respuesta suficiente limpia el pendiente.
  const ok = await orchestrate(q("ahora sí completo"), deps("Dato [D1].\n<!--FUENTES: D1-->"), { autorizada: true, aclaracionPendiente: true });
  assert.equal(ok.aclaracionPendiente, false);
});

test("DI-21 anónimas: la aclaración pide pregunta completa y no arrastra estado", async () => {
  const out = await orchestrate(q("necesito un permiso"), deps("¿Qué permiso?\n<!--TIPO: aclaracion-->"), { autorizada: false, aclaracionPendiente: false });
  assert.equal(out.tipo, "aclaración");
  assert.match(out.respuesta, /pregunta completa en un solo mensaje/);
  assert.equal(out.aclaracionPendiente, false, "nada se persiste para anónimas");
  // Aunque llegara un pendiente espurio, una anónima nunca encadena: vuelve a pedir la pregunta completa.
  const otra = await orchestrate(q("necesito un permiso"), deps("¿Qué permiso?\n<!--TIPO: aclaracion-->"), { autorizada: false, aclaracionPendiente: true });
  assert.equal(otra.tipo, "aclaración");
});
