import test from "node:test";
import assert from "node:assert/strict";
import { createChatAdminDb } from "./chatAdminDb.js";
import { setChatPoolForTests } from "../../src/chat/db.js";
import { readiness } from "../../src/routes/health.js";

const OK_ENV = { CHAT_ALLOWED_ORIGINS: "https://geobot.ejemplo.gov.co", CONSENT_POLICY_VERSION: "2026-10", CONSENT_POLICY_URL: "https://ejemplo.gov.co/p", TOKENIZER_DIR: "/app/var/tokenizer" };

test("la readiness se bloquea mientras falten contactos, tarifas, configuración o índice, y nombra qué falta", async () => {
  const db = await createChatAdminDb();
  setChatPoolForTests(db.chat);
  const saved = { ...process.env };
  try {
    for (const k of ["CHAT_ALLOWED_ORIGINS", "CONSENT_POLICY_VERSION", "CONSENT_POLICY_URL", "TOKENIZER_DIR"]) delete process.env[k];
    let r = await readiness("ready", "vigente");
    assert.equal(r.ready, false);
    assert.deepEqual(r.checks.filter(c => !c.ok).map(c => c.name).sort(), ["configuracion", "contactos", "tarifas"]);

    Object.assign(process.env, OK_ENV);
    r = await readiness("ready", "vigente");
    assert.deepEqual(r.checks.filter(c => !c.ok).map(c => c.name).sort(), ["contactos", "tarifas"]);

    await db.admin.query(`INSERT INTO admin.contact_reception VALUES (1, 'https://p.gov.co', '300 111 2233', 'a@b.co')`);
    await db.admin.query(`INSERT INTO admin.contact_general VALUES (1, '604 555 0100', 'i@b.co', 'https://p.gov.co/c')`);
    await db.admin.query(`INSERT INTO admin.contact_immediate (name, description, type, value, position) VALUES ('E','d','teléfono','123',1)`);
    await db.admin.query(`INSERT INTO chat.tariff (model_id, region, currency, input_price_per_million, output_price_per_million, valid_from, source_url)
      VALUES ('openai.gpt-oss-20b-1:0','us-east-1','USD',0.07,0.3,'2026-01-01','https://aws.amazon.com/bedrock/pricing/')`);
    r = await readiness("ready", "vigente");
    assert.deepEqual(r.checks.filter(c => !c.ok).map(c => c.name), ["tarifas"], "falta la tarifa del 120b");
    await db.admin.query(`INSERT INTO chat.tariff (model_id, region, currency, input_price_per_million, output_price_per_million, valid_from, source_url)
      VALUES ('openai.gpt-oss-120b-1:0','us-east-1','USD',0.15,0.6,'2026-01-01','https://aws.amazon.com/bedrock/pricing/')`);
    r = await readiness("ready", "vigente");
    assert.equal(r.ready, true);
    assert.equal((await readiness("error", "vigente")).ready, false, "índice caído");
    for (const c of ["ausente", "incompatible", "no_comprobada"]) {
      const x = await readiness("ready", c);
      assert.equal(x.ready, false, `calibración ${c}`);
      assert.deepEqual(x.checks.filter(k => !k.ok).map(k => k.name), ["calibracion"]);
    }
    assert.ok(!JSON.stringify(r).match(/postgres|password|AWS_|secret/i));
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    setChatPoolForTests(undefined);
    await db.close();
  }
});
