/**
 * Arnés de las pruebas de integración del bloque 2.
 *
 * PostgreSQL y Qdrant son los reales de las pruebas de la KB; el único doble es el
 * cliente Converse, que no abre red. Todo resultado nacido de aquí lleva
 * `adapter: "double"` y NO cuenta como aceptación de AWS (contracts/acceptance.md).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { crearBaseDePrueba, type BaseDePrueba } from "../kb-integracion/helpers.js";

export const ADAPTER = "double" as const;

export type DiCase = {
  id: string;
  requisito: string;
  cantidades: Record<string, number>;
  estado: "pendiente" | "ok" | "fallo";
};
export type DiManifest = {
  version: string;
  adapter: typeof ADAPTER | "aws";
  responsable_manual: string | null;
  identidad: Record<string, string | null>;
  casos: DiCase[];
};

export function loadManifest(): DiManifest {
  const url = new URL("../fixtures/di/manifest.json", import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as DiManifest;
}

/** Reloj controlable: las pruebas de sesión (29/31 min) y de purga (11 m 29 d / 12 m 1 d) no esperan. */
export class FakeClock {
  constructor(private ms = Date.UTC(2026, 9, 8, 12, 0, 0)) {}
  now = (): number => this.ms;
  date = (): Date => new Date(this.ms);
  advance(ms: number): void { this.ms += ms; }
  advanceMinutes(min: number): void { this.advance(min * 60_000); }
  advanceDays(days: number): void { this.advance(days * 86_400_000); }
}

export type ConverseOutcome =
  | { kind: "ok"; text: string; inputTokens: number; outputTokens: number; stopReason?: "end_turn" | "max_tokens" }
  | { kind: "error"; message: string };

export type ConverseCall = { modelId: string; system: string; messages: unknown[]; maxTokens: number; temperature: number };

/** Cliente Converse sin red: devuelve respuestas guionizadas por modelo y registra cada llamada. */
export class FakeConverse {
  readonly adapter = ADAPTER;
  readonly calls: ConverseCall[] = [];
  private script = new Map<string, ConverseOutcome[]>();
  private fallback: ConverseOutcome = { kind: "error", message: "sin guion para este modelo" };

  on(modelId: string, ...outcomes: ConverseOutcome[]): this {
    this.script.set(modelId, [...(this.script.get(modelId) ?? []), ...outcomes]);
    return this;
  }

  async send(call: ConverseCall): Promise<ConverseOutcome> {
    this.calls.push(call);
    const queue = this.script.get(call.modelId);
    return queue?.shift() ?? this.fallback;
  }

  callsTo(modelId: string): ConverseCall[] { return this.calls.filter(c => c.modelId === modelId); }
}

export type DiHarness = { db: BaseDePrueba; clock: FakeClock; converse: FakeConverse; close: () => Promise<void> };

/** Base PostgreSQL nueva (roles y esquema de producción), reloj y Converse dobles. */
export async function createHarness(): Promise<DiHarness> {
  const db = await crearBaseDePrueba();
  return { db, clock: new FakeClock(), converse: new FakeConverse(), close: () => db.borrar() };
}
