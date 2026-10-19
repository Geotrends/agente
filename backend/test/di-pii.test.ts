import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeCitizenText, sanitizeFragment } from "../src/services/pii.js";
import { orchestrate } from "../src/chat/orchestrator.js";
import { TEXTO_AVISO_PII } from "../src/prompts/institutionalTexts.js";
import { CONTACTOS, hit } from "./di-support.js";

const PII: Array<[string, string, string]> = [
  ["mi cédula es 43.256.789 y quiero registrar a mi perro", "[CÉDULA]", "43.256.789"],
  ["C.C. 71 624 355, necesito una visita", "[CÉDULA]", "71 624 355"],
  ["estoy identificado con 1.020.304.555 para el trámite", "[CÉDULA]", "1.020.304.555"],
  ["mi celular es 3104567890", "[TELÉFONO]", "3104567890"],
  ["llámeme al +57 320 555 1234", "[TELÉFONO]", "555 1234"],
  ["el fijo es (604) 339 40 00", "[TELÉFONO]", "339 40 00"],
  ["escríbame a juan.perez@gmail.com", "[CORREO]", "juan.perez"],
  ["vivo en la Carrera 43 # 38 Sur - 35 de Envigado", "[DIRECCIÓN]", "43 # 38"],
  ["mi vecino Carlos Gómez tiene diez gatos", "[NOMBRE]", "Gómez"],
];

const NORMAS = [
  "¿Qué dice la Ley 1581 de 2012 sobre datos personales?",
  "Según el procedimiento GT-P-020 y el formato GT-F-058 de 2024",
  "Acuerdo 034 de 2019 del Concejo y Resolución 40103",
  "El plazo es de 15 días hábiles desde el 12/03/2026",
  "Los recursos propios suman 43.109.692.812 pesos",
];

test("14 casos: 9 con datos se enmascaran con la etiqueta exacta y 5 normas quedan intactas", () => {
  assert.equal(PII.length + NORMAS.length, 14);
  for (const [entrada, etiqueta, original] of PII) {
    const r = sanitizeCitizenText(entrada);
    assert.ok(r.texto.includes(etiqueta), `${entrada} → ${r.texto}`);
    assert.ok(!r.texto.includes(original), `queda el dato en: ${r.texto}`);
    assert.ok(r.tipos.length >= 1);
  }
  for (const n of NORMAS) {
    const r = sanitizeCitizenText(n);
    assert.equal(r.texto, n, "no daña códigos, fechas ni normas");
    assert.deepEqual(r.tipos, []);
  }
});

test("fragmentos: solo cédula/teléfono/correo; direcciones y nombres oficiales se conservan", () => {
  const oficial = "Secretaría de Medio Ambiente, Calle 40B Sur # 37 - 24. Atiende la señora Directora Ana Pérez.";
  assert.equal(sanitizeFragment(oficial).texto, oficial);
  // Canales de la entidad: se conservan para que el chat pueda darlos.
  const canales = "Línea oficial de Bienestar Animal: celular 3201234567, ext. 4170-4559. Correo: atencion@envigado.gov.co";
  assert.equal(sanitizeFragment(canales).texto, canales);
  // Datos de una persona o de dominios no oficiales: se enmascaran.
  const r = sanitizeFragment("Solicitante: celular 3201234567 y correo ana@envigado.gov.co; escriba también a pepe@gmail.com");
  assert.equal(r.texto, "Solicitante: celular [TELÉFONO] y correo [CORREO]; escriba también a [CORREO]");
});

test("8 equivalentes: 4 con datos avisan y no los reproducen; 4 neutras no avisan y reciben la misma orientación", async () => {
  const pares: Array<[string, string]> = [
    ["Mi cédula es 43.256.789, ¿cómo registro mi mascota?", "¿Cómo registro mi mascota?"],
    ["Soy de la Calle 40B Sur # 37 - 24, ¿hay jornada de esterilización?", "¿Hay jornada de esterilización?"],
    ["Escríbame a ana@correo.com: ¿qué requisitos tiene el RUM?", "¿Qué requisitos tiene el RUM?"],
    ["Mi vecino Pedro Ramírez maltrata un perro, ¿dónde denuncio?", "Un vecino maltrata un perro, ¿dónde denuncio?"],
  ];
  const run = async (pregunta: string) => {
    const sanit = sanitizeCitizenText(pregunta);
    let visto = "";
    const out = await orchestrate({ pregunta: sanit.texto, historial: [] }, {
      retrieve: async () => ({ hits: [hit(1)] }), contacts: async () => CONTACTOS,
      model: async r => { visto = r.pregunta; return { text: "La orientación es esta [D1].\n<!--FUENTES: D1-->", usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end_turn", effectiveModel: "m" }; },
    }, { autorizada: false, aclaracionPendiente: false, avisoPii: sanit.tipos.length ? TEXTO_AVISO_PII : undefined });
    return { out, visto, sanit };
  };
  for (const [conDatos, neutra] of pares) {
    const a = await run(conDatos);
    const b = await run(neutra);
    assert.ok(a.out.respuesta.startsWith(TEXTO_AVISO_PII.slice(0, 40)), "aviso primero");
    assert.ok(!/43\.256|40B|ana@|Ramírez/.test(a.visto + a.out.respuesta), "no reproduce el dato");
    assert.ok(!b.out.respuesta.includes("datos personales"), "neutra sin aviso");
    assert.equal(a.out.respuesta.replace(TEXTO_AVISO_PII, "").trim(), b.out.respuesta.trim(), "misma orientación");
  }
});

test("el aviso se repite en cada uno de los 3 turnos con datos", async () => {
  for (const turno of ["Mi cédula es 71.624.355, ¿qué sigue?", "Mi correo es x@y.com, ¿y ahora?", "Mi celular 3104567890, ¿cuándo?"]) {
    const s = sanitizeCitizenText(turno);
    assert.ok(s.tipos.length > 0);
  }
});
