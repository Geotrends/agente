/** Contrato de valoración (contracts/feedback-api.md): selección cerrada, sin texto libre. */
export const MOTIVOS = [
  "Información incorrecta",
  "Información desactualizada",
  "No responde mi pregunta",
  "Difícil de entender",
  "Otro",
] as const;
export type Motivo = (typeof MOTIVOS)[number];
export type Valoracion = "Útil" | "No útil";

export type RatingBody = { responseId: string; valoracion: Valoracion; motivo?: Motivo };

/** «Útil» no lleva motivo; «No útil» exige exactamente uno de los cinco. */
export function buildRatingBody(responseId: string, valoracion: Valoracion, motivo?: Motivo): RatingBody | undefined {
  if (valoracion === "Útil") return motivo === undefined ? { responseId, valoracion } : undefined;
  return motivo && (MOTIVOS as readonly string[]).includes(motivo) ? { responseId, valoracion, motivo } : undefined;
}
