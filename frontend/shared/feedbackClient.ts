/**
 * Cliente de POST /api/ratings. El éxito se declara SOLO con un 201 `{responseId, registrada:true}`
 * del mismo responseId: un rechazo (400, incluido el de duplicado tras pérdida de acuse) jamás se
 * interpreta como éxito idempotente, y el cliente no permite cambiar la valoración para evadirlo.
 */
import { AGENT_CHAT_URL } from "./agentConfig";
import { readJsonBody } from "./chatErrors";
import { buildRatingBody, type Motivo, type Valoracion } from "./feedbackContracts";
import { fetchWithSession } from "./session";

const RATINGS_URL = AGENT_CHAT_URL.replace(/\/chat$/, "/ratings");
export const RATING_DEADLINE_MS = 15_000;

export type RatingOutcome = { kind: "registrada" } | { kind: "rechazada" } | { kind: "fallo" };

export async function submitRating(
  responseId: string, valoracion: Valoracion, motivo: Motivo | undefined, external?: AbortSignal,
): Promise<RatingOutcome> {
  const body = buildRatingBody(responseId, valoracion, motivo);
  if (!body) return { kind: "rechazada" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), RATING_DEADLINE_MS);
  const onExternal = () => ctl.abort();
  external?.addEventListener("abort", onExternal, { once: true });
  try {
    const r = await fetchWithSession(AGENT_CHAT_URL, RATINGS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const data = await readJsonBody<{ responseId?: unknown; registrada?: unknown }>(r);
    if (r.status === 201 && data?.registrada === true && data.responseId === responseId) return { kind: "registrada" };
    if (r.status === 400) return { kind: "rechazada" };
    return { kind: "fallo" };
  } catch {
    return { kind: "fallo" };
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", onExternal);
  }
}
