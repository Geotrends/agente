import assert from "node:assert/strict";
import test from "node:test";
import { containsPersonalData, maskPersonalData } from "../src/services/pii.js";

/**
 * La mitad importante de estas pruebas es la segunda: el corpus es normativo y
 * está lleno de números que parecen documentos de identidad. Enmascararlos
 * arruinaría las preguntas de evaluación de A-12 sin que nadie se entere.
 */

test("enmascara los datos personales que llegan de verdad a un canal de atención", () => {
  const casos: Array<[string, string]> = [
    ["mi cédula es 43.256.789", "[documento]"],
    ["cedula 1032456789", "[documento]"],
    ["C.C. 71 624 355", "[documento]"],
    ["documento de identidad No. 1.020.304", "[documento]"],
    ["escríbame a juan.perez@envigado.gov.co", "[correo]"],
    ["mi celular es 3104567890", "[teléfono]"],
    ["llámeme al +57 320 555 1234", "[teléfono]"],
    ["NIT 890.900.608-9", "[NIT]"],
    ["matrícula inmobiliaria 001-234567", "[matrícula]"],
  ];
  for (const [entrada, etiqueta] of casos) {
    const salida = maskPersonalData(entrada);
    assert.ok(salida.includes(etiqueta), `"${entrada}" debería producir ${etiqueta}, dio "${salida}"`);
    assert.ok(!/\d{6,}/.test(salida.replace(/\[\w+\]/g, "")), `"${salida}" todavía deja dígitos del dato`);
  }
});

test("conserva la palabra que dice de qué dato se trata", () => {
  // Quien audite el registro necesita saber que se preguntó por una cédula;
  // lo que no debe quedar es el número.
  assert.match(maskPersonalData("mi cédula es 43.256.789"), /cédula/i);
  assert.match(maskPersonalData("NIT 890.900.608-9"), /NIT/i);
});

test("NO toca la numeración normativa, que es la que alimenta la evaluación", () => {
  const normativa = [
    "¿Qué dice la Ley 1581 de 2012 sobre datos personales?",
    "El Decreto 1074 de 2015 reglamenta el sector comercio",
    "Acuerdo 034 de 2019 del Concejo de Envigado",
    "Resolución 40103 del Ministerio de Minas",
    "¿Cuál es el plazo del artículo 2341 del Código Civil?",
    "Acuerdo 032 (Septiembre 23 de 2004)",
    "el POT fue adoptado en 2011 y modificado en 2019",
    "boletín de calidad del aire de noviembre de 2025",
  ];
  for (const texto of normativa) {
    assert.equal(maskPersonalData(texto), texto, `no debería tocarse: "${texto}"`);
    assert.equal(containsPersonalData(texto), false);
  }
});

test("un número largo suelto, sin ancla léxica, se deja en paz", () => {
  // Es la decisión deliberada del módulo: preferir un falso negativo a
  // destruir una pregunta legítima. Queda documentado como límite conocido.
  assert.equal(maskPersonalData("el radicado 20230145678 quedó en trámite"), "el radicado 20230145678 quedó en trámite");
});

test("NO toca las cifras presupuestales, que es lo que más abunda en el corpus", () => {
  // Medido sobre las 1.105 interacciones reales: una regla por formato
  // ("número con separadores de miles") enmascaraba 14 cifras de dinero por
  // cada documento de identidad. Por eso esa regla no existe.
  const presupuesto = [
    "| Recursos propios | 43.109.692.812 |",
    "- Desarrollo económico: $2.018.000.000",
    "600.000.000 para Obras de protección en quebrada la Sebastiana",
    "**Asignación básica:** $1.865.000",
    "| Presupuesto 2005 (total) | 75.171.209.236 |",
  ];
  for (const texto of presupuesto) {
    assert.equal(maskPersonalData(texto), texto, `cifra presupuestal enmascarada: "${texto}"`);
  }
});

test("enmascara varias apariciones en el mismo texto", () => {
  const salida = maskPersonalData("cédula 43.256.789 y correo ana@x.gov.co y celular 3009998877");
  assert.ok(salida.includes("[documento]"));
  assert.ok(salida.includes("[correo]"));
  assert.ok(salida.includes("[teléfono]"));
});

test("texto sin datos personales pasa intacto", () => {
  const texto = "¿Cómo solicito el certificado de estratificación?";
  assert.equal(maskPersonalData(texto), texto);
  assert.equal(containsPersonalData(texto), false);
});
