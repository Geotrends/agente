/**
 * Sondas de salud, fuera de /api: sin token y sin límite de tasa.
 *
 *   /health  Vivacidad: el proceso responde. Es lo que usa el HEALTHCHECK de Docker. No mira
 *            el índice a propósito: una reconstrucción puede tardar horas.
 *
 *   /ready   Disponibilidad: el chat puede responder ahora mismo. Exige índice cargado con calibración vigente,
 *            configuración válida (solo Bedrock, sin llaves estáticas, orígenes y política),
 *            tarifas vigentes para los dos modelos, tokenizador con la huella fijada y el
 *            registro oficial de contactos completo. Si falta algo NO se declara listo; la
 *            respuesta nombra qué falta, sin valores ni secretos.
 */
import { Router } from "express";
import { readContactSnapshot } from "../admin/contacts.js";
import { chatPool } from "../chat/db.js";
import { tokenizerArtifactMatchesPin } from "../chat/outputTokenizer.js";
import { missingTariffs } from "../chat/tariffs.js";
import { ALLOWED_BEDROCK_MODELS, validateDiConfig } from "../services/diConfig.js";
import { getRetrievalStatus } from "../services/retrievalClient.js";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({ ok: true });
});

export type ReadinessCheck = { name: string; ok: boolean };

export async function readiness(
  indexState: string = getRetrievalStatus().state,
  calibration: string = getRetrievalStatus().calibracion,
): Promise<{ ready: boolean; index: string; checks: ReadinessCheck[] }> {
  const state = indexState;
  const checks: ReadinessCheck[] = [
    // "refreshing" sigue sirviendo con el índice anterior.
    { name: "indice", ok: state === "ready" || state === "refreshing" },
    // El umbral debe venir de una calibración vigente de la colección servida (RF-C3-DI-05).
    { name: "calibracion", ok: calibration === "vigente" },
    { name: "configuracion", ok: validateDiConfig().length === 0 },
    { name: "tokenizador", ok: tokenizerArtifactMatchesPin() },
  ];
  try {
    const db = chatPool();
    checks.push({ name: "contactos", ok: (await readContactSnapshot(db)) !== null });
    checks.push({ name: "tarifas", ok: (await missingTariffs([...ALLOWED_BEDROCK_MODELS], new Date(), db)).length === 0 });
  } catch {
    checks.push({ name: "contactos", ok: false }, { name: "tarifas", ok: false });
  }
  return { ready: checks.every(c => c.ok), index: state, checks };
}

/**
 * Llamada directa desde el propio contenedor (operación): sin proxy delante y desde loopback.
 * Por el proxy público siempre llega X-Forwarded-For, así que un anónimo nunca cumple esto.
 */
export function isInternalCaller(req: { headers: Record<string, unknown>; socket: { remoteAddress?: string } }): boolean {
  if (req.headers["x-forwarded-for"] || req.headers["forwarded"] || req.headers["x-real-ip"]) return false;
  const a = req.socket.remoteAddress ?? "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

// SPEC008 (FR-019): a un anónimo solo se le dice si el chat está listo. El detalle (qué falla,
// estado del índice, configuración) lo ve operación desde el contenedor y el panel autenticado.
router.get("/ready", async (req, res) => {
  const r = await readiness();
  if (isInternalCaller(req)) { res.status(r.ready ? 200 : 503).json(r); return; }
  if (!r.ready) console.warn(`[ready] no listo: ${r.checks.filter(c => !c.ok).map(c => c.name).join(", ")}`);
  res.status(r.ready ? 200 : 503).json({ ready: r.ready });
});

export default router;
