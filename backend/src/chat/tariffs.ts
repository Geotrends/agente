/**
 * Tarifas y costo estimado (RF-C3-DI-16). Aritmética decimal: el costo se puede recalcular a
 * mano. Costo cero solo para la ruta sin LLM; si falta la tarifa vigente NO se inventa un cero.
 */
import { Decimal } from "decimal.js";
import type pg from "pg";
import { setting } from "../services/settings.js";
import { chatPool } from "./db.js";

/** Pool o conexión: lo único que se necesita es `query`. */
export type Queryable = { query(text: string, values?: unknown[]): Promise<pg.QueryResult> };

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
/** Decimales almacenados (numeric(24,12)). */
export const COST_SCALE = 12;

export type Tariff = { version: number; modelId: string; inputPerMillion: string; outputPerMillion: string; currency: string };

export const MODEL_LABEL: Record<string, "gpt-oss-20b" | "gpt-oss-120b"> = {
  "openai.gpt-oss-20b-1:0": "gpt-oss-20b",
  "openai.gpt-oss-120b-1:0": "gpt-oss-120b",
};

/** costo = (entrada × precioEntrada + salida × precioSalida) / 1.000.000, a 12 decimales. */
export function computeCost(inputTokens: number, outputTokens: number, t: Pick<Tariff, "inputPerMillion" | "outputPerMillion">): string {
  return new D(inputTokens).mul(t.inputPerMillion).add(new D(outputTokens).mul(t.outputPerMillion)).div(1_000_000).toDecimalPlaces(COST_SCALE).toFixed(COST_SCALE);
}

export async function currentTariff(modelId: string, at: Date = new Date(), db: Queryable = chatPool()): Promise<Tariff | null> {
  const { rows } = await db.query(
    `SELECT version, model_id, input_price_per_million::text AS i, output_price_per_million::text AS o, currency
       FROM chat.tariff WHERE model_id = $1 AND region = $2 AND valid_from <= $3 AND (valid_to IS NULL OR valid_to > $3)
       ORDER BY valid_from DESC LIMIT 1`,
    [modelId, setting("bedrockRegion"), at]);
  const r = rows[0];
  return r ? { version: Number(r.version), modelId: r.model_id, inputPerMillion: r.i, outputPerMillion: r.o, currency: r.currency } : null;
}

/** Readiness: ambos modelos deben tener tarifa vigente. */
export async function missingTariffs(models: string[], at: Date = new Date(), db: pg.Pool = chatPool()): Promise<string[]> {
  const out: string[] = [];
  for (const m of models) if (!(await currentTariff(m, at, db))) out.push(m);
  return out;
}
