import test from "node:test";
import assert from "node:assert/strict";
import { cuerpoConsulta, estadoInicial, historialParaEnviar, puedeConsultar, reducir, type EstadoChat } from "../shared/consent";
import { esEnlaceSeguro, type RespuestaChat } from "../shared/chatContracts";

const resp = (t: string): RespuestaChat => ({ modo: "conversación", tipo: "respondida", respuesta: t, fuentes: [] });

function conversar(e: EstadoChat, n: number): EstadoChat {
  for (let i = 0; i < n; i++) {
    e = reducir(e, { tipo: "enviar", pregunta: `p${i}` });
    e = reducir(e, { tipo: "respondida", respuesta: resp(`r${i}`) });
  }
  return e;
}

test("sin decisión no se puede consultar: ni por la interfaz ni armando el cuerpo a mano", () => {
  assert.equal(puedeConsultar(estadoInicial), false);
  assert.throws(() => cuerpoConsulta(estadoInicial, "hola"), /consentimiento/);
  assert.deepEqual(reducir(estadoInicial, { tipo: "enviar", pregunta: "x" }), estadoInicial);
});

test("Autorizo: usa el UUID del backend y envía hasta los 10 últimos pares", () => {
  let e = reducir(estadoInicial, { tipo: "autorizar", conversationId: "uuid-del-backend" });
  assert.equal(puedeConsultar(e), true);
  assert.deepEqual(cuerpoConsulta(e, "primera"), { pregunta: "primera", conversationId: "uuid-del-backend" });
  e = conversar(e, 15);
  const h = historialParaEnviar(e);
  assert.equal(h.length, 10);
  assert.deepEqual(h[9], { pregunta: "p14", respuesta: "r14" });
  const cuerpo = cuerpoConsulta(e, "otra", "Ecosistemas");
  assert.equal(cuerpo.conversationId, "uuid-del-backend");
  assert.deepEqual(Object.keys(cuerpo).sort(), ["categoria", "conversationId", "historial", "pregunta"]);
});

test("No autorizo: 5 consultas, 2 de seguimiento, sin historial ni conversationId ni preguntas acumuladas", () => {
  let e = reducir(estadoInicial, { tipo: "no_autorizar" });
  for (const q of ["¿Qué es el RUM?", "¿y el costo?", "¿y el plazo?", "otra", "última"]) {
    assert.deepEqual(cuerpoConsulta(e, q), { pregunta: q });
    e = reducir(e, { tipo: "enviar", pregunta: q });
    assert.equal(e.fase === "abierta" && e.mensajes.length, 1, "solo la consulta actual en pantalla");
    e = reducir(e, { tipo: "respondida", respuesta: { modo: "anónima", tipo: "respondida", respuesta: "r", fuentes: [] } });
    assert.deepEqual(historialParaEnviar(e), []);
    assert.equal(e.fase === "abierta" && e.pares.length, 0);
  }
});

test("recargar o reiniciar descarta todo: se vuelve a pedir la decisión", () => {
  let e = reducir(estadoInicial, { tipo: "autorizar", conversationId: "u" });
  e = conversar(e, 3);
  e = reducir(e, { tipo: "reiniciar" });
  assert.deepEqual(e, estadoInicial);
  assert.equal(puedeConsultar(e), false);
});

test("un fallo no entra al historial y libera la consulta", () => {
  let e = reducir(estadoInicial, { tipo: "autorizar", conversationId: "u" });
  e = reducir(e, { tipo: "enviar", pregunta: "p" });
  assert.equal(puedeConsultar(e), false, "una consulta a la vez");
  e = reducir(e, { tipo: "fallo", mensaje: "no disponible" });
  assert.equal(puedeConsultar(e), true);
  assert.deepEqual(historialParaEnviar(e), []);
});

test("solo se abren enlaces https", () => {
  assert.equal(esEnlaceSeguro("https://envigado.gov.co/x"), true);
  for (const mal of ["http://x.co", "javascript:alert(1)", "data:text/html,x", "//x.co", "ftp://x"]) assert.equal(esEnlaceSeguro(mal), false);
});
