/**
 * El registro central de configuración (M-8).
 *
 * Lo que se fija aquí no es que valide —de eso ya se encarga config.ts— sino
 * que la declaración sea ÚNICA y que siga leyéndose en caliente: las pruebas y
 * una clave rotada dependen de lo segundo.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { describeSettings, setting, SETTINGS } from "../src/services/settings.js";

test("cada variable se declara una sola vez y con nombre único", () => {
  const nombres = Object.values(SETTINGS).map(s => s.env);
  assert.equal(new Set(nombres).size, nombres.length, "hay una variable declarada dos veces");
});

test("los rangos declarados contienen a su propio valor por defecto", () => {
  for (const spec of Object.values(SETTINGS)) {
    if (spec.kind === "bool" || spec.kind === "string") continue;
    const defaults = spec.kind === "int-list" ? spec.default : [spec.default];
    for (const value of defaults) {
      assert.ok(value >= spec.min && value <= spec.max,
        `${spec.env}: el defecto ${value} cae fuera de [${spec.min}, ${spec.max}]`);
    }
  }
});

test("el valor se lee en el momento de la llamada, no al importar el módulo", () => {
  const previo = process.env.RETRIEVAL_MAX_PER_DOCUMENT;
  try {
    process.env.RETRIEVAL_MAX_PER_DOCUMENT = "5";
    assert.equal(setting("retrievalMaxPerDocument"), 5);
    process.env.RETRIEVAL_MAX_PER_DOCUMENT = "2";
    assert.equal(setting("retrievalMaxPerDocument"), 2, "un cambio en caliente debe verse");
  } finally {
    if (previo === undefined) delete process.env.RETRIEVAL_MAX_PER_DOCUMENT;
    else process.env.RETRIEVAL_MAX_PER_DOCUMENT = previo;
  }
});

test("un valor fuera de rango se recorta al extremo, no se descarta", () => {
  const previo = process.env.RETRIEVAL_MAX_PER_DOCUMENT;
  try {
    process.env.RETRIEVAL_MAX_PER_DOCUMENT = "999";
    assert.equal(setting("retrievalMaxPerDocument"), SETTINGS.retrievalMaxPerDocument.max);
  } finally {
    if (previo === undefined) delete process.env.RETRIEVAL_MAX_PER_DOCUMENT;
    else process.env.RETRIEVAL_MAX_PER_DOCUMENT = previo;
  }
});

test("el diagnóstico distingue lo que viene del entorno de lo que es defecto", () => {
  const previo = process.env.RERANK_CANDIDATES;
  try {
    process.env.RERANK_CANDIDATES = "12";
    const fila = describeSettings().find(s => s.env === "RERANK_CANDIDATES")!;
    assert.equal(fila.source, "entorno");
    assert.equal(fila.value, "12");
    assert.ok(fila.doc.length > 10, "cada variable debe documentar para qué sirve");
  } finally {
    if (previo === undefined) delete process.env.RERANK_CANDIDATES;
    else process.env.RERANK_CANDIDATES = previo;
  }
});

// Los mínimos de estos dos ajustes son requisitos del contrato, no preferencias:
// ninguna configuración puede bajarlos (RF-C3-IV-07, RNF-C3-IV-03).
for (const [nombre, env, bajo, minimo] of [
  ["ocrMinConfidence", "OCR_MIN_CONFIDENCE", "60", 80],
  ["kbRetencionMeses", "KB_RETENCION_MESES", "11", 12],
] as const) {
  test(`${env} no admite valores por debajo de ${minimo}`, () => {
    const previo = process.env[env];
    try {
      process.env[env] = bajo;
      assert.equal(setting(nombre), minimo);
    } finally {
      if (previo === undefined) delete process.env[env];
      else process.env[env] = previo;
    }
  });
}
