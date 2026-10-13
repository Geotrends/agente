import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createChatAdminDb } from "./chatAdminDb.js";
import { readContactSnapshot } from "../../src/admin/contacts.js";
import { createConversation, loadConversation, saveClarification } from "../../src/chat/conversations.js";
import { saveAnonymousUsage, saveInteraction } from "../../src/chat/records.js";
import type { ModelAdapter } from "../../src/chat/contracts.js";
import { MATRIX } from "../../scripts/lib/diAcceptance.js";
import { produceEvidence } from "../../scripts/lib/diRunner.js";
import { hit } from "../di-support.js";

test("la matriz cubre los 28 criterios DI con las cantidades del manifiesto", async () => {
  const manifest = JSON.parse(await fs.readFile(new URL("../fixtures/di/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(MATRIX.map(c => c.id), manifest.casos.map((c: { id: string }) => c.id));
  assert.equal(MATRIX.length, 28);
  const casos = (id: string) => MATRIX.find(c => c.id === id)!.cases.length;
  assert.equal(casos("DI-01"), 10);
  assert.equal(casos("DI-04"), 10);
  assert.equal(casos("DI-09"), 15);
  assert.equal(casos("DI-19"), 10);
  assert.equal(casos("DI-26"), 15);
  assert.equal(casos("DI-28"), 10);
  assert.equal(casos("DI-18"), 9, "6 cortes + 3 normales");
  for (const c of MATRIX) assert.ok(c.cases.length > 0 || c.delegadaA, `${c.id}: sin casos ni runner delegado`);
});

test("el runner escribe evidencia, fuerza cada modelo, rotula el doble y nunca aprueba lo que exige revisión", async () => {
  const db = await createChatAdminDb();
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "eval-di-"));
  try {
    await db.admin.query(`INSERT INTO admin.contact_reception VALUES (1, 'https://pqrsd.prueba.gov.co', '+57 300 000 1111', 'pqrsd@prueba.gov.co')`);
    await db.admin.query(`INSERT INTO admin.contact_general VALUES (1, '(604) 000 2222', 'info@prueba.gov.co', 'https://prueba.gov.co/contacto')`);
    await db.admin.query(`INSERT INTO admin.contact_immediate (name, description, type, value, position) VALUES ('E','d','teléfono','123',1)`);
    const llamados: string[] = [];
    const adapter: ModelAdapter = {
      call: async (modelId) => {
        llamados.push(modelId);
        const corto = Number(process.env.BEDROCK_MAX_OUTPUT_TOKENS ?? 2200) < 200;
        return {
          text: `${"El trámite exige presentar la solicitud y esperar la validación [D1]. ".repeat(corto ? 40 : 2)}\n<!--FUENTES: D1-->`,
          usage: { inputTokens: 50, outputTokens: 10 }, stopReason: corto ? "max_tokens" : "end_turn", effectiveModel: modelId,
        };
      },
    };
    const { results, summary } = await produceEvidence({
      outDir: out, adapterLabel: "double", models: "both", adapter, forceCutTokens: 80,
      only: ["DI-01", "DI-04", "DI-09", "DI-18", "DI-23", "DI-26", "DI-02"],
      deps: {
        contacts: () => readContactSnapshot(db.chat),
        retrieve: async q => ({ hits: /sancocho|ajiaco|Everest|Mongolia|ajedrez|pasaje/.test(q) ? [] : [hit(1)] }),
        loadConversation: (id, sub) => loadConversation(id, sub, db.chat),
        saveClarification: (id, p) => saveClarification(id, p, db.chat),
        saveInteraction: (rec, h) => saveInteraction(rec, h, db.chat),
        saveAnonymousUsage: (rec, h) => saveAnonymousUsage(rec, h, db.chat),
      },
      newConversation: () => createConversation("matriz", "2026-10", db.chat),
      environment: { region: "us-east-1" }, responsable: null,
    });
    // Se forzó cada uno de los dos modelos, y cada caso quedó rotulado.
    assert.ok(llamados.includes("openai.gpt-oss-20b-1:0") && llamados.includes("openai.gpt-oss-120b-1:0"));
    assert.ok(results.every(r => r.adapter === "double"));
    // Análisis: rechazo local antes del modelo (pasa); semántica: queda null aunque lo automático pase.
    assert.ok(results.filter(r => r.criterio === "DI-01" && r.caso.startsWith("análisis")).every(r => r.pass === true));
    assert.ok(results.filter(r => r.criterio === "DI-01" && r.caso.startsWith("trámite")).every(r => r.pass === null && r.manual));
    assert.ok(results.filter(r => r.criterio === "DI-04" && r.caso.startsWith("ausente")).every(r => r.pass === true), "ausencia con texto exacto, sin modelo");
    assert.ok(results.filter(r => r.criterio === "DI-18" && r.caso.startsWith("corte")).every(r => r.pass === true), "cortes: aviso exacto y ≤2200 " + JSON.stringify(results.filter(r => r.criterio === "DI-18").slice(0,2)));
    assert.ok(results.filter(r => r.criterio === "DI-18" && r.caso.startsWith("normal")).every(r => r.pass === true));
    assert.ok(results.filter(r => r.criterio === "DI-23").every(r => r.pass === true), "el dato no llega al proveedor y hay aviso");
    assert.ok(results.filter(r => r.criterio === "DI-26").every(r => r.pass === true), "15 payloads sin datos y solo 10 pares");
    assert.equal(results.find(r => r.criterio === "DI-02")!.pass, null, "los delegados no se dan por buenos");
    assert.equal(summary.fallados, 0, JSON.stringify(results.filter(r => r.pass === false)));

    for (const f of ["manifest.json", "results.json", "informe.md"]) await fs.access(path.join(out, f));
    const manifest = JSON.parse(await fs.readFile(path.join(out, "manifest.json"), "utf8"));
    assert.match(manifest.aceptacionReal, /NO: adapter=double/);
    assert.equal(manifest.firmaRevisionFuncional, null);
    assert.ok(manifest.git && manifest.hashCambiosLocales && manifest.matrizHash && manifest.prompt);
    assert.equal(manifest.tokenizador.encoding, "o200k_harmony");
    assert.match(await fs.readFile(path.join(out, "informe.md"), "utf8"), /no cuenta como aceptación de AWS/);
  } finally {
    await fs.rm(out, { recursive: true, force: true });
    await db.close();
  }
});
