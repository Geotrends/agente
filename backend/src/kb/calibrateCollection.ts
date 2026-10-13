/**
 * Calibra una colección candidata contra el oro vigente (RF-C3-DI-05). Corre el recuperador real
 * (BM25 + denso + RRF + reranker) sobre ESA colección, sin tocar la pública, y deja el informe
 * completo que luego guarda `saveCalibration`.
 */
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { runtimeVersions } from "../services/calibration.js";
import { retrieveCandidates } from "../services/search.js";
import { aliasKb } from "../services/qdrant.js";
import { buildReport, CalibrationError, type CalibrationQuestion, type CalibrationReport } from "./calibration.js";

export type GoldCase = { id: string; query: string; kind: "factual" | "abstention" | "unanswerable" };
export type GoldSet = { cases: GoldCase[] };

export async function loadGold(path: string): Promise<{ gold: GoldSet; hash: string }> {
  const raw = await fs.readFile(path);
  return { gold: JSON.parse(raw.toString("utf8")) as GoldSet, hash: createHash("sha256").update(raw).digest("hex") };
}

export type Retriever = typeof retrieveCandidates;

export async function calibrateCollection(
  coleccion: string, gold: GoldSet, goldHash: string, info: { corpusHash: string },
  retrieve: Retriever = retrieveCandidates,
): Promise<CalibrationReport> {
  const questions: CalibrationQuestion[] = [];
  for (const c of gold.cases) {
    // «Sin texto extraíble» no es un fallo de recuperación: se excluye y queda anotado en el oro.
    if (c.kind === "unanswerable") continue;
    const set = await retrieve(c.query, undefined, coleccion);
    if (set.reranked === null) throw new CalibrationError("El reranker no estuvo disponible: no se puede calibrar.");
    const scores = set.reranked;
    questions.push({
      id: c.id, kind: c.kind === "factual" ? "respondible" : "ausente",
      candidates: set.candidates.map(k => ({
        id: k.id, rerank: scores.get(k.id) ?? Number.NEGATIVE_INFINITY,
        documentId: set.payloads[k.id].elemento_id, text: set.payloads[k.id].texto,
      })),
    });
  }
  const v = runtimeVersions();
  return buildReport(questions, {
    corpusAlias: aliasKb(), coleccion, corpusHash: info.corpusHash, goldenSetHash: goldHash,
    embeddingVersion: v.embedding, rerankerVersion: v.reranker,
  });
}
