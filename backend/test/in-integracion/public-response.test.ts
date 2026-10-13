/** T026 — contrato público de la respuesta: nada malformado sale como 200 (RF-C3-IN-03). */
import test from "node:test";
import assert from "node:assert/strict";
import { assertPublicResponse, PublicResponseError, type RespuestaPublica } from "../../src/chat/contracts.js";

const ID = "00000000-0000-4000-8000-000000000001";
const FUENTE = { id: "doc-1", nombre: "Documento 1", enlace: "https://prueba.gov.co/doc-1.pdf", fecha: "2026-03-15" };
const OK: RespuestaPublica = { modo: "conversación", conversationId: ID, responseId: ID, tipo: "respondida", respuesta: "Texto [D1]", fuentes: [FUENTE] };

const regla = (r: unknown): string | undefined => {
  try { assertPublicResponse(r as RespuestaPublica); return undefined; } catch (e) { return e instanceof PublicResponseError ? e.regla : "otro"; }
};

test("respuesta válida pasa; anónima y sin responseId también", () => {
  assert.equal(regla(OK), undefined);
  assert.equal(regla({ modo: "anónima", tipo: "sin información", respuesta: "Sin información", fuentes: [] }), undefined);
  assert.equal(regla({ ...OK, responseId: undefined }), undefined);
});

test("cada violación del contrato se rechaza con su regla", () => {
  assert.equal(regla({ ...OK, tipo: "otra" }), "tipo");
  assert.equal(regla({ ...OK, respuesta: "  " }), "respuesta_vacia");
  assert.equal(regla({ modo: "anónima", tipo: "respondida", respuesta: "x", fuentes: [FUENTE], conversationId: ID }), "anonima_con_identificador");
  assert.equal(regla({ ...OK, conversationId: "no-uuid" }), "conversationId");
  assert.equal(regla({ ...OK, responseId: "r1" }), "responseId");
  assert.equal(regla({ ...OK, tipo: "sin información" }), "fuentes_en_no_respondida");
  assert.equal(regla({ ...OK, fuentes: [] }), "respondida_sin_fuente");
  assert.equal(regla({ ...OK, fuentes: [{ ...FUENTE, enlace: "http://prueba.gov.co/a" }] }), "fuente_enlace");
  assert.equal(regla({ ...OK, fuentes: [{ ...FUENTE, fecha: "15/03/2026" }] }), "fuente_incompleta");
  assert.equal(regla({ ...OK, fuentes: [FUENTE, FUENTE] }), "fuente_duplicada");
  assert.equal(regla({ ...OK, modo: "otro" }), "modo");
});

// ── T034 · allowlist de lo persistido ─────────────────────────────────────────────────────────
import { persistableSources } from "../../src/chat/records.js";
import { sanitizeForRecord } from "../../src/services/pii.js";

test("fuentes persistibles: solo {id, nombre, enlace, fecha}; cualquier otro campo no llega a la tabla", () => {
  const sucio = [{ ...FUENTE, texto: "fragmento con 3104567890", usuario: "ana@correo.com", consulta: "¿cómo?" }];
  assert.deepEqual(persistableSources(sucio as unknown as typeof OK.fuentes), [FUENTE]);
});

test("registro: etiquetas exactas, canales oficiales intactos y códigos/normas/fechas sin tocar", () => {
  const oficial = ["+57 300 111 2233", "pqrsd@prueba.gov.co"];
  const texto = "Escriba a pqrsd@prueba.gov.co o al +57 300 111 2233. Su cédula 43.256.789 y el correo ana@correo.com. Ver GT-F-012, Ley 1581 de 2012, Decreto 1074 del 26 de mayo de 2015.";
  const out = sanitizeForRecord(texto, oficial);
  assert.ok(out.includes("pqrsd@prueba.gov.co") && out.includes("+57 300 111 2233"));
  assert.ok(out.includes("[CÉDULA]") && out.includes("[CORREO]"));
  assert.ok(!out.includes("43.256.789") && !out.includes("ana@correo.com"));
  for (const intacto of ["GT-F-012", "Ley 1581 de 2012", "Decreto 1074 del 26 de mayo de 2015"]) assert.ok(out.includes(intacto));
});
