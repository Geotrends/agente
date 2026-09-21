/**
 * Contrato de comportamiento de BM25, reutilizable por cualquier implementación.
 *
 * Existe para la fase F2 del plan, que sustituye el `Map` por fragmento por un
 * índice invertido CSR. La implementación nueva se valida llamando a
 * `describeBm25Contract("BM25 invertido", docs => new InvertedBM25(docs))`:
 * si pasa el contrato y la prueba de equivalencia, el cambio es seguro.
 *
 * La prueba más fuerte no compara contra la implementación actual sino contra una
 * REFERENCIA INDEPENDIENTE de la fórmula BM25 escrita aquí abajo, ingenua y
 * obviamente correcta. Así el contrato fija la especificación, no el
 * comportamiento accidental del código de hoy.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { terms, type Ranked } from "../src/services/retrievalMath.js";

export type Bm25Like = { search(query: string): Ranked[] };
export type Bm25Factory = (documents: string[]) => Bm25Like;

/** Constantes de la fórmula. Congeladas durante el plan (ver "constantes congeladas"). */
export const K1 = 1.2;
export const B = 0.75;

/**
 * Referencia ingenua de BM25, derivada de la fórmula y no del código de producción.
 * Reproduce las mismas guardas que `retrievalMath.ts:38` para el corpus vacío.
 */
export function referenceScores(documents: string[], query: string): Ranked[] {
  const tokenised = documents.map(document => terms(document));
  const lengths = tokenised.map(tokens => tokens.length);
  const average = lengths.reduce((a, b) => a + b, 0) / (documents.length || 1) || 1;
  const n = documents.length;

  const documentFrequency = new Map<string, number>();
  for (const tokens of tokenised) {
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const queryTokens = [...new Set(terms(query))];
  return tokenised
    .map((tokens, id) => {
      let score = 0;
      for (const token of queryTokens) {
        const tf = tokens.filter(candidate => candidate === token).length;
        const df = documentFrequency.get(token) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * lengths[id]) / average));
      }
      return { id, score };
    })
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score || a.id - b.id);
}

export function assertRankingEquivalent(
  actual: Ranked[],
  expected: Ranked[],
  message: string,
  tolerance = 1e-9,
): void {
  assert.deepEqual(
    actual.map(r => r.id), expected.map(r => r.id),
    `${message}: el orden de los documentos no coincide`,
  );
  for (const [index, result] of expected.entries()) {
    const delta = Math.abs(actual[index].score - result.score);
    const allowed = tolerance * Math.max(1, Math.abs(result.score));
    assert.ok(
      delta <= allowed,
      `${message}: puntaje del documento ${result.id} — esperado ${result.score}, obtenido ${actual[index].score} (Δ ${delta.toExponential(2)})`,
    );
  }
}

/** Corpus fijo con el vocabulario del dominio real. */
export const CONTRACT_CORPUS = [
  "ruido ruido ambiental en la zona urbana de Envigado",
  "ruido ambiental y acústica según el acuerdo municipal",
  "ruidoso",
  "permiso de vertimientos y licencia ambiental",
  "vertimientos vertimientos vertimientos en el cauce",
  "calidad del aire y material particulado",
];

export function describeBm25Contract(name: string, create: Bm25Factory): void {
  const build = () => create(CONTRACT_CORPUS);

  test(`${name}: reproduce la fórmula BM25 de referencia`, () => {
    const index = build();
    for (const query of [
      "ruido", "ambiental", "vertimientos", "acústica",
      "ruido ambiental", "permiso de vertimientos ambiental",
      "calidad del aire en Envigado", "ACÚSTICA MUNICIPAL",
    ]) {
      assertRankingEquivalent(
        index.search(query),
        referenceScores(CONTRACT_CORPUS, query),
        `consulta "${query}"`,
      );
    }
  });

  test(`${name}: normaliza acentos y mayúsculas`, () => {
    const index = build();
    assert.deepEqual(
      index.search("ACÚSTICA").map(r => r.id),
      index.search("acustica").map(r => r.id),
    );
    assert.equal(index.search("ACÚSTICA")[0].id, 1);
  });

  test(`${name}: coincide por token completo, no por subcadena`, () => {
    const index = build();
    // "ruidoso" (documento 2) no debe aparecer al buscar "ruido".
    assert.deepEqual(index.search("ruido").map(r => r.id).sort(), [0, 1]);
    assert.deepEqual(index.search("ruidoso").map(r => r.id), [2]);
  });

  test(`${name}: descarta palabras vacías y términos de una letra`, () => {
    const index = build();
    assert.deepEqual(index.search("de la el los y en con por para"), []);
    assert.deepEqual(index.search("a"), []);
  });

  test(`${name}: un término ausente no devuelve nada`, () => {
    assert.deepEqual(build().search("termino-que-no-existe"), []);
    assert.deepEqual(build().search(""), []);
  });

  test(`${name}: los términos raros pesan más que los frecuentes`, () => {
    // "ambiental" aparece en 3 documentos; "acústica" solo en el 1.
    const index = create([
      "ambiental acústica",
      "ambiental",
      "ambiental",
      "ambiental",
    ]);
    const scores = index.search("ambiental acústica");
    assert.equal(scores[0].id, 0, "el documento con el término raro debe ir primero");
  });

  test(`${name}: más ocurrencias del término puntúan más`, () => {
    const index = create(["vertimientos", "vertimientos vertimientos vertimientos"]);
    const results = index.search("vertimientos");
    assert.equal(results[0].id, 1, "el documento con mayor tf debe ir primero");
  });

  test(`${name}: normaliza por longitud del documento`, () => {
    // Mismo tf, distinta longitud: el documento corto debe puntuar más alto.
    const padding = " relleno".repeat(40);
    const index = create(["vertimientos", `vertimientos${padding}`]);
    const results = index.search("vertimientos");
    assert.equal(results[0].id, 0, "el documento más corto debe ir primero");
  });

  test(`${name}: ordena descendente y desempata por id ascendente`, () => {
    const index = create(["ruido ambiental", "ruido ambiental", "ruido ambiental"]);
    const results = index.search("ruido ambiental");
    assert.deepEqual(results.map(r => r.id), [0, 1, 2], "documentos idénticos: id ascendente");
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1].score >= results[i].score, "los puntajes deben ir descendiendo");
    }
  });

  test(`${name}: solo devuelve puntajes positivos`, () => {
    const index = build();
    for (const result of index.search("ruido ambiental vertimientos aire")) {
      assert.ok(result.score > 0, `el documento ${result.id} tiene puntaje ${result.score}`);
    }
  });

  test(`${name}: cubrir más términos de la consulta vale más`, () => {
    const index = create([
      "ruido ambiental vertimientos",
      "ruido ambiental",
      "ruido",
    ]);
    assert.deepEqual(index.search("ruido ambiental vertimientos").map(r => r.id), [0, 1, 2]);
  });

  test(`${name}: es determinista`, () => {
    const index = build();
    assert.deepEqual(index.search("ruido ambiental"), index.search("ruido ambiental"));
  });

  test(`${name}: tolera el corpus vacío y los documentos vacíos`, () => {
    assert.deepEqual(create([]).search("lo que sea"), []);
    assert.deepEqual(create(["", "  "]).search("lo que sea"), []);
    // Un corpus de un solo documento no debe dividir por cero.
    assert.equal(create(["ruido"]).search("ruido").length, 1);
  });

  test(`${name}: los términos repetidos en la consulta no cuentan dos veces`, () => {
    const index = build();
    assertRankingEquivalent(
      index.search("ruido ruido ruido"),
      index.search("ruido"),
      "término repetido en la consulta",
    );
  });
}
