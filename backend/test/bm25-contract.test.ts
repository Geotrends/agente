/**
 * Corre el contrato de BM25 contra la implementación actual.
 *
 * En F2, cuando el `Map` por fragmento se sustituya por un índice invertido CSR,
 * se añade aquí una segunda llamada a `describeBm25Contract` con la clase nueva,
 * más la prueba de equivalencia directa entre ambas. Mientras las dos convivan,
 * este archivo demuestra que devuelven exactamente lo mismo.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BM25 } from "../src/services/retrievalMath.js";
import { NaiveBM25 } from "./oracles.js";
import {
  CONTRACT_CORPUS, assertRankingEquivalent, describeBm25Contract, referenceScores,
} from "./bm25-contract.js";

// La implementación de producción (índice invertido CSR) y la original, que se
// conserva solo como referencia. Las dos deben cumplir el mismo contrato.
describeBm25Contract("BM25 invertido", documents => new BM25(documents));
describeBm25Contract("NaiveBM25", documents => new NaiveBM25(documents));

test("las dos implementaciones son idénticas, no solo equivalentes", () => {
  // Tolerancia CERO: el índice invertido suma las contribuciones por término en
  // el mismo orden y acumula en float64, así que los puntajes salen bit a bit
  // iguales. Cualquier diferencia delataría un cambio real en la fórmula.
  const corpora = [
    CONTRACT_CORPUS,
    ["ruido", "ruido ambiental", "ambiental acústica ruido", "vertimientos"],
    Array.from({ length: 60 }, (_, i) =>
      `documento ${i} sobre ${i % 3 === 0 ? "vertimientos" : "ruido"} ambiental en Envigado ${"relleno ".repeat(i % 7)}`),
  ];
  const queries = [
    "ruido", "ambiental", "vertimientos acústica", "ruido ambiental Envigado",
    "documento 7", "término inexistente", "RUÍDO AMBIENTAL",
  ];

  for (const [index, corpus] of corpora.entries()) {
    const inverted = new BM25(corpus);
    const naive = new NaiveBM25(corpus);
    for (const query of queries) {
      assertRankingEquivalent(
        inverted.search(query), naive.search(query),
        `corpus ${index}, consulta "${query}"`, 0,
      );
    }
  }
});

test("el índice invertido acota el rango y el top-k como lo hacía filtrar después", () => {
  const corpus = Array.from({ length: 80 }, (_, i) =>
    `fragmento ${i} ruido ambiental ${i % 4 === 0 ? "vertimientos" : ""} ${"texto ".repeat(i % 5)}`);
  const inverted = new BM25(corpus);
  const naive = new NaiveBM25(corpus);
  const query = "ruido ambiental vertimientos";

  // top-k equivale a ordenar todo y cortar.
  assertRankingEquivalent(
    inverted.search(query, 0, corpus.length, 10),
    naive.search(query).slice(0, 10),
    "top-10", 0,
  );

  // Un rango [lo, hi) equivale a filtrar por id y luego cortar.
  const [lo, hi] = [20, 55];
  assertRankingEquivalent(
    inverted.search(query, lo, hi, 10),
    naive.search(query).filter(r => r.id >= lo && r.id < hi).slice(0, 10),
    "rango contiguo", 0,
  );

  // Y `eligible` equivale a filtrar por predicado y luego cortar.
  const eligible = (id: number) => id % 3 === 0;
  assertRankingEquivalent(
    inverted.search(query, 0, corpus.length, 10, eligible),
    naive.search(query).filter(r => eligible(r.id)).slice(0, 10),
    "predicado", 0,
  );
});

test("el acumulador queda limpio entre consultas", () => {
  // El acumulador se comparte entre llamadas y solo se limpian las posiciones
  // tocadas: si esa limpieza fallara, la segunda consulta arrastraría puntajes.
  const inverted = new BM25(CONTRACT_CORPUS);
  const first = inverted.search("ruido ambiental");
  inverted.search("vertimientos");
  inverted.search("acústica");
  assertRankingEquivalent(inverted.search("ruido ambiental"), first, "tras otras consultas", 0);
});

test("la referencia de la fórmula es coherente con un cálculo hecho a mano", () => {
  // Corpus mínimo donde los números se pueden verificar con lápiz y papel:
  // N=2, el término "ruido" aparece en los dos documentos (df=2).
  //   idf = ln(1 + (2 - 2 + 0.5) / (2 + 0.5)) = ln(1.2)
  // Documento 0: 1 token, tf=1. Documento 1: 2 tokens, tf=1. avg = 1.5
  //   d0: ln(1.2) * 1 * 2.2 / (1 + 1.2 * (0.25 + 0.75 * 1 / 1.5))
  //   d1: ln(1.2) * 1 * 2.2 / (1 + 1.2 * (0.25 + 0.75 * 2 / 1.5))
  const corpus = ["ruido", "ruido ambiental"];
  const idf = Math.log(1.2);
  const average = 1.5;
  const expected = [1, 2].map(length =>
    (idf * 1 * 2.2) / (1 + 1.2 * (0.25 + (0.75 * length) / average)));

  const reference = referenceScores(corpus, "ruido");
  assert.equal(reference.length, 2);
  assert.ok(Math.abs(reference[0].score - expected[0]) < 1e-12, "documento corto");
  assert.ok(Math.abs(reference[1].score - expected[1]) < 1e-12, "documento largo");

  // Y la implementación de producción coincide con ese cálculo.
  assertRankingEquivalent(new BM25(corpus).search("ruido"), reference, "cálculo manual");
});

test("el contrato cubre el corpus de referencia completo", () => {
  // Guarda contra un corpus de contrato que se vacíe por accidente en el futuro.
  assert.ok(CONTRACT_CORPUS.length >= 5);
  const index = new BM25(CONTRACT_CORPUS);
  assert.ok(index.search("ruido ambiental vertimientos aire").length >= 4,
    "el corpus debe producir suficientes coincidencias para que el contrato sea significativo");
});
