/**
 * Verificación de evidencia de validación (SPEC007 T074, RF-C4-AD-04, constitución IX).
 *
 * Para pasar un caso a «Validada» o «Cerrada» se exigen referencias a corridas de SPEC006 que
 * existan en el índice autorizado, con su huella SHA-256, versión y fecha POSTERIOR al ajuste. El
 * panel no acepta rutas del usuario ni «marca» corridas: solo contrasta contra el índice que
 * produce la herramienta de validación. Sin índice no se puede verificar y la transición se
 * rechaza (no se simula aceptación). No cierra hallazgos ni actas de SPEC006.
 */
import fs from "node:fs/promises";

export type EvidenceRef = { runId: string; sha256: string; releaseId: string };

export type VerifiedEvidence = EvidenceRef & { finishedAt: string };

type IndexRun = { runId: string; sha256: string; releaseId: string; finishedAt: string; status: string };

export class EvidenceError extends Error {
  constructor(readonly codigo: "INDICE_NO_DISPONIBLE" | "REFERENCIA_INVALIDA" | "NO_ENCONTRADA" | "NO_COMPLETA" | "NO_POSTERIOR", mensaje: string) {
    super(mensaje); this.name = "EvidenceError";
  }
}

const SHA = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9._:-]{1,80}$/;

export function parseEvidenceRefs(raw: unknown): EvidenceRef[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 10) {
    throw new EvidenceError("REFERENCIA_INVALIDA", "Indique de una a diez referencias de evidencia de validación.");
  }
  return raw.map(r => {
    const o = (r ?? {}) as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.some(k => !["runId", "sha256", "releaseId"].includes(k))) throw new EvidenceError("REFERENCIA_INVALIDA", "La referencia solo admite runId, sha256 y releaseId.");
    if (typeof o.runId !== "string" || !ID.test(o.runId) || typeof o.releaseId !== "string" || !ID.test(o.releaseId)
      || typeof o.sha256 !== "string" || !SHA.test(o.sha256)) {
      throw new EvidenceError("REFERENCIA_INVALIDA", "La referencia de evidencia no tiene el formato esperado (runId, sha256 de 64 hex, releaseId).");
    }
    return { runId: o.runId, sha256: o.sha256, releaseId: o.releaseId };
  });
}

export type EvidenceVerifier = (refs: EvidenceRef[], after: Date) => Promise<VerifiedEvidence[]>;

async function loadIndex(path: string): Promise<IndexRun[]> {
  try {
    const crudo = JSON.parse(await fs.readFile(path, "utf8")) as { runs?: IndexRun[] };
    return Array.isArray(crudo.runs) ? crudo.runs : [];
  } catch {
    throw new EvidenceError("INDICE_NO_DISPONIBLE", "El índice de evidencia de validación no está disponible: no se puede verificar.");
  }
}

/** Verificador por defecto: `VALIDATION_EVIDENCE_INDEX` apunta al JSON que publica la herramienta de SPEC006. */
export const verifyEvidence: EvidenceVerifier = async (refs, after) => {
  const path = process.env.VALIDATION_EVIDENCE_INDEX?.trim();
  if (!path) throw new EvidenceError("INDICE_NO_DISPONIBLE", "No hay índice de evidencia de validación configurado: no se puede verificar.");
  const index = await loadIndex(path);
  return refs.map(ref => {
    const run = index.find(r => r.runId === ref.runId && r.sha256 === ref.sha256 && r.releaseId === ref.releaseId);
    if (!run) throw new EvidenceError("NO_ENCONTRADA", `La corrida ${ref.runId} no existe con esa huella y versión.`);
    if (run.status !== "complete") throw new EvidenceError("NO_COMPLETA", `La corrida ${ref.runId} no está completa.`);
    const fin = new Date(run.finishedAt);
    if (Number.isNaN(fin.getTime()) || fin <= after) throw new EvidenceError("NO_POSTERIOR", `La corrida ${ref.runId} no es posterior al ajuste.`);
    return { ...ref, finishedAt: fin.toISOString() };
  });
};
