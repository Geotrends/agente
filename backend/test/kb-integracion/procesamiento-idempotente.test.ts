/**
 * Un elemento se registra una sola vez por corrida en `kb_procesamiento`
 * (T088; FR-012, FR-013, SC-006): retomar o repetir el procesamiento de una
 * corrida no infla el conteo de cargados + descartados.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { registrarProcesamiento, type Conversion } from "../../src/kb/conversion.js";
import { crearBaseDePrueba, type BaseDePrueba } from "./helpers.js";

let base: BaseDePrueba;

const conversion = (decision: Conversion["decision"], confianzaOcr: number | null): Conversion => ({
  texto: "", formatoOriginal: "pdf", caracteresNativos: 0, ocrAplicado: true, confianzaOcr,
  calidadNativaBaja: false, decision, detalle: null, duracionMs: 1,
});

async function corrida(): Promise<string> {
  const id = randomUUID();
  await base.kb.query(
    `INSERT INTO kb.kb_corrida (id, iniciada_en, terminada_en, programada, completa, informe, estado, latido_en)
     VALUES ($1, now(), now(), true, false, 'x.json', 'en_proceso', now())`, [id]);
  return id;
}

before(async () => { base = await crearBaseDePrueba(); });
after(async () => { await base?.borrar(); });

test("registrar dos veces el mismo documento en la misma corrida deja una sola fila", async () => {
  const id = await corrida();
  const a = await registrarProcesamiento(base.kb, "https://ambientometroenvigado.com/a.pdf", conversion("descartado_ocr", 50), id);
  const b = await registrarProcesamiento(base.kb, "https://ambientometroenvigado.com/a.pdf", conversion("descartado_ocr", 50), id);
  assert.equal(a, b);
  const { rowCount } = await base.kb.query("SELECT 1 FROM kb.kb_procesamiento WHERE corrida_id = $1", [id]);
  assert.equal(rowCount, 1);
});

test("el mismo documento en corridas distintas conserva una fila por corrida", async () => {
  const clave = "https://ambientometroenvigado.com/b.pdf";
  await registrarProcesamiento(base.kb, clave, conversion("cargado", 90), await corrida());
  await registrarProcesamiento(base.kb, clave, conversion("cargado", 90), await corrida());
  const { rowCount } = await base.kb.query("SELECT 1 FROM kb.kb_procesamiento WHERE clave_elemento = $1", [clave]);
  assert.equal(rowCount, 2);
});
