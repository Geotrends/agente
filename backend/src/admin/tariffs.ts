/**
 * Tarifas de los dos modelos (SPEC007 US7, RF-C3-AD-42): edición con vigencia desde el servidor.
 *
 * Una edición NUNCA reescribe precios anteriores: bajo un candado por modelo+región cierra la
 * vigencia actual y abre otra sin solape (el instante lo fija el servidor). Los costos ya
 * registrados no se recalculan; el registro usa `received_at` para elegir la tarifa, así que una
 * consulta recibida antes del guardado conserva la anterior aunque termine después.
 */
import type pg from "pg";
import { adminPool, adminTx } from "./db.js";
import { writeAudit } from "./audit.js";
import { ApiError } from "./contracts.js";
import { adminClock } from "./sessions.js";
import { parsePrice, parseRevision, strictObject } from "./validation.js";
import { setting } from "../services/settings.js";

export const MODELOS = { "gpt-oss-20b": "openai.gpt-oss-20b-1:0", "gpt-oss-120b": "openai.gpt-oss-120b-1:0" } as const;
export type EtiquetaModelo = keyof typeof MODELOS;

export type TarifaDto = {
  modelo: EtiquetaModelo; region: string; moneda: string; version: string;
  inputPerMillion: string; outputPerMillion: string; vigenteDesde: string; fuente: string;
};

const quitarCeros = (n: string): string => (n.includes(".") ? n.replace(/0+$/, "").replace(/\.$/, "") : n);

export async function listarTarifas(db: pg.Pool = adminPool()): Promise<{ items: TarifaDto[]; faltantes: EtiquetaModelo[] }> {
  const region = setting("bedrockRegion");
  const items: TarifaDto[] = [];
  const faltantes: EtiquetaModelo[] = [];
  for (const [etiqueta, id] of Object.entries(MODELOS) as Array<[EtiquetaModelo, string]>) {
    const { rows } = await db.query(
      `SELECT version, region, currency, input_price_per_million::text AS i, output_price_per_million::text AS o, valid_from, source_url
         FROM chat.tariff WHERE model_id = $1 AND region = $2 AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now())
        ORDER BY valid_from DESC LIMIT 1`, [id, region]);
    const r = rows[0];
    if (!r) { faltantes.push(etiqueta); continue; }
    items.push({
      modelo: etiqueta, region: r.region, moneda: r.currency, version: String(r.version),
      inputPerMillion: quitarCeros(r.i), outputPerMillion: quitarCeros(r.o), vigenteDesde: new Date(r.valid_from).toISOString(), fuente: r.source_url,
    });
  }
  return { items, faltantes };
}

export async function guardarTarifa(actor: string, modeloRaw: string, body: unknown, db: pg.Pool = adminPool()): Promise<TarifaDto> {
  if (!(modeloRaw in MODELOS)) throw new ApiError(404, "NO_ENCONTRADO", "El modelo no existe.");
  const etiqueta = modeloRaw as EtiquetaModelo;
  const modelId = MODELOS[etiqueta];
  const b = strictObject(body, ["expectedRevision", "inputPerMillion", "outputPerMillion"], ["expectedRevision", "inputPerMillion", "outputPerMillion"]);
  const esperada = parseRevision(b.expectedRevision);
  const entrada = parsePrice(b.inputPerMillion, "inputPerMillion");
  const salida = parsePrice(b.outputPerMillion, "outputPerMillion");
  const region = setting("bedrockRegion");

  await adminTx(async c => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`tariff:${modelId}:${region}`]);
    const actual = (await c.query(
      `SELECT version, valid_from, source_url FROM chat.tariff
        WHERE model_id = $1 AND region = $2 AND valid_to IS NULL ORDER BY valid_from DESC LIMIT 1 FOR UPDATE`, [modelId, region])).rows[0];
    if (!actual) throw new ApiError(409, "SIN_TARIFA_VIGENTE", "No hay una tarifa vigente de la cual partir. Cárguela con el procedimiento de instalación.");
    if (String(actual.version) !== esperada) throw new ApiError(409, "REVISION_OBSOLETA", "La tarifa cambió. Recargue y vuelva a intentar.");
    // El instante lo fija la base de datos al guardar (no el cliente).
    const ahora = (await c.query("SELECT clock_timestamp() AS t")).rows[0].t as Date;
    if (ahora.getTime() <= new Date(actual.valid_from).getTime()) {
      throw new ApiError(409, "CONFLICTO_DE_VIGENCIA", "Ya hay una edición con la misma marca de tiempo. Intente de nuevo.");
    }
    await c.query("UPDATE chat.tariff SET valid_to = $2 WHERE version = $1", [actual.version, ahora]);
    await c.query(
      `INSERT INTO chat.tariff (model_id, region, currency, input_price_per_million, output_price_per_million, valid_from, source_url)
       VALUES ($1,$2,'USD',$3,$4,$5,$6)`, [modelId, region, entrada, salida, ahora, actual.source_url]);
    await writeAudit(c, { actor, action: "tarifa.editar", objectType: "tarifa", objectId: etiqueta, result: "ok" }, new Date(adminClock.now()));
  }, db);
  const { items } = await listarTarifas(db);
  return items.find(t => t.modelo === etiqueta)!;
}
