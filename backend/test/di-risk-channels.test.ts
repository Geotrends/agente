import test from "node:test";
import assert from "node:assert/strict";
import { afectacionEnCurso, bloqueCanalesInmediatos } from "../src/chat/riskPolicy.js";
import { orchestrate } from "../src/chat/orchestrator.js";
import type { ContactSnapshot } from "../src/chat/contracts.js";
import { CONTACTOS, hit } from "./di-support.js";

const EN_CURSO = [
  "Están maltratando a un perro en la esquina de mi casa",
  "Hay un perro herido sangrando en la vía, ayuda",
  "Se está muriendo un caballo atropellado frente al parque",
  "Hay un incendio en el humedal ahora mismo",
  "Acabo de ver a alguien envenenando gatos",
];
const INFORMATIVAS = [
  "¿Qué dice la norma sobre el maltrato animal?", "¿Cómo se registra una mascota?", "¿Qué pasa si un animal es atropellado, en general?",
  "¿Qué requisitos tiene un permiso de quema?", "¿Quién atiende los incendios forestales en el municipio?",
];

const MULTI: ContactSnapshot = {
  ...CONTACTOS,
  inmediatos: [
    { id: "b", name: "Policía Ambiental", description: "Denuncias en curso", type: "teléfono", value: "(604) 111 2222", position: 2 },
    { id: "a", name: "Línea 123", description: "Emergencias", type: "teléfono", value: "123", position: 1 },
    { id: "c", name: "Reporte web", description: "Formulario", type: "url", value: "https://prueba.gov.co/reporte", position: 3 },
  ],
};

test("DI-19: ≥4/5 en curso activan los canales y ≤1/5 informativas", () => {
  assert.ok(EN_CURSO.filter(afectacionEnCurso).length >= 4);
  assert.ok(INFORMATIVAS.filter(afectacionEnCurso).length <= 1);
});

test("los canales salen del snapshot, en su orden y con sus valores exactos, y van antes de la orientación", async () => {
  const bloque = bloqueCanalesInmediatos(MULTI);
  assert.ok(bloque.indexOf("Línea 123") < bloque.indexOf("Policía Ambiental"));
  assert.ok(bloque.indexOf("Policía Ambiental") < bloque.indexOf("Reporte web"));
  for (const v of ["123", "(604) 111 2222", "https://prueba.gov.co/reporte"]) assert.ok(bloque.includes(v), v);

  const out = await orchestrate({ pregunta: EN_CURSO[0], historial: [] }, {
    retrieve: async () => ({ hits: [hit(1)] }), contacts: async () => MULTI,
    model: async () => ({ text: "Oriente así [D1].\n<!--FUENTES: D1-->", usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end_turn", effectiveModel: "m" }),
  });
  assert.ok(out.respuesta.indexOf("Línea 123") < out.respuesta.indexOf("Oriente así"));
  assert.ok(out.respuesta.indexOf("Policía Ambiental") !== -1);

  // Una consulta informativa no antepone canales de urgencia.
  const info = await orchestrate({ pregunta: INFORMATIVAS[1], historial: [] }, {
    retrieve: async () => ({ hits: [hit(1)] }), contacts: async () => MULTI,
    model: async () => ({ text: "Se registra así [D1].\n<!--FUENTES: D1-->", usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end_turn", effectiveModel: "m" }),
  });
  assert.ok(!info.respuesta.includes("Línea 123"));
});

test("sin canales vigentes no se inventan números", () => {
  const sin = bloqueCanalesInmediatos({ ...CONTACTOS, inmediatos: [] });
  assert.ok(!/\d{3}/.test(sin));
});
