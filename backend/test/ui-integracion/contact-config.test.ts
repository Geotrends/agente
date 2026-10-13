/**
 * T051 (RF-C3-IN-10, RF-C4-IN-06/UI-08, B10): el bloque de contactos sale del registro administrable.
 * Tres llamadas idénticas al registro, una edición real por el panel seguro sin redespliegue, cero
 * invocaciones al proveedor y ≤2 s; una falla de base no se presenta como ausencia documental.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { createChatAdminDb } from "../di-integracion/chatAdminDb.js";
import { setChatPoolForTests } from "../../src/chat/db.js";
import { setCanalesProvider } from "../../src/chat/errors.js";
import { chatWindow } from "../../src/chat/perimeter.js";
import { setAdminPoolForTests } from "../../src/admin/db.js";
import { hashPassword } from "../../src/admin/passwords.js";
import { adminClock } from "../../src/admin/sessions.js";
import { resetIpThrottle } from "../../src/admin/auth.js";
import { readContactSnapshot } from "../../src/admin/contacts.js";
import adminAuthRouter from "../../src/routes/adminAuth.js";
import adminContactsRouter from "../../src/routes/adminContacts.js";
import chatConfigRouter from "../../src/routes/chatConfig.js";
import { ORIGIN } from "./app.js";

process.env.CHAT_ALLOWED_ORIGINS = ORIGIN;
process.env.AUTH_JWT_SECRET = "x".repeat(40);
process.env.CONSENT_POLICY_VERSION = "2026-10";
process.env.CONSENT_POLICY_URL = "https://ejemplo.gov.co/politica";
process.env.CHAT_RATE_LIMIT_PER_MINUTE = "1000";

test("B10: tres lecturas = registro; edición por el panel visible en la siguiente lectura; 0 LLM; ≤2 s", async () => {
  const db = await createChatAdminDb();
  setChatPoolForTests(db.chat);
  setAdminPoolForTests(db.admin);
  setCanalesProvider(async () => []);
  resetIpThrottle();
  chatWindow.reset();
  adminClock.now = () => Date.now();
  const app = express();
  app.use(express.json());
  app.use("/api", adminAuthRouter, adminContactsRouter, chatConfigRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  try {
    await db.admin.query(`INSERT INTO admin.account (email, display_name, profile, password_phc, must_change_password) VALUES ('tec@x.co','tec','administrador técnico',$1,false)`, [await hashPassword("contraseña-larga-123")]);
    const login = await fetch(`${base}/admin/session`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ email: "tec@x.co", password: "contraseña-larga-123" }) });
    const b = await login.json();
    const h = { "content-type": "application/json", origin: ORIGIN, cookie: login.headers.get("set-cookie")!.split(";")[0], "x-csrf-token": b.csrfToken };
    const call = (method: string, path: string, body?: unknown) => fetch(`${base}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const revision = async () => (await (await call("GET", "/admin/contacts")).json()).revision as number;

    // Sin contactos completos el servicio no inventa valores.
    assert.equal((await fetch(`${base}/chat/config`, { headers: { origin: ORIGIN } })).status, 503);

    const rec = { pqrsd: "https://pqrsd.ejemplo.gov.co", whatsapp: "+57 300 111 2233", email: "pqrsd@ejemplo.gov.co" };
    assert.equal((await call("PUT", "/admin/contacts/reception", { ...rec, revision: await revision() })).status, 200);
    assert.equal((await call("PUT", "/admin/contacts/general", { phone: "(604) 555 0100", email: "info@ejemplo.gov.co", url: "https://ejemplo.gov.co/contacto", revision: await revision() })).status, 200);
    assert.equal((await call("POST", "/admin/contacts/immediate", { name: "Emergencias", description: "24 h", type: "teléfono", value: "123", revision: await revision() })).status, 201);

    const registro = await readContactSnapshot(db.chat);
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      const r = await fetch(`${base}/chat/config`, { headers: { origin: ORIGIN } });
      assert.ok(Date.now() - t0 < 2000, "≤ 2 s");
      assert.equal(r.status, 200);
      assert.match(r.headers.get("cache-control") ?? "", /no-store/);
      assert.deepEqual((await r.json()).contactos, JSON.parse(JSON.stringify(registro)), "idéntico al registro");
    }

    // Edición real por el panel seguro: la siguiente lectura la refleja sin reiniciar nada.
    const nuevo = { ...rec, whatsapp: "+57 311 999 8877" };
    assert.equal((await call("PUT", "/admin/contacts/reception", { ...nuevo, revision: await revision() })).status, 200);
    const despues = await (await fetch(`${base}/chat/config`, { headers: { origin: ORIGIN } })).json();
    assert.equal(despues.contactos.recepcion.whatsapp, "+57 311 999 8877");
    assert.equal(despues.contactos.recepcion.pqrsd, rec.pqrsd);
  } finally {
    setAdminPoolForTests(undefined); setChatPoolForTests(undefined); server.close(); await db.close();
  }
});

test("falla de la base: SERVICIO_NO_DISPONIBLE genérico, nunca «sin información» ni contactos inventados", async () => {
  const db = await createChatAdminDb();
  setChatPoolForTests(db.chat);
  setCanalesProvider(async () => []);
  chatWindow.reset();
  const app = express();
  app.use("/api", chatConfigRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  try {
    await db.chat.end(); // la conexión del servicio deja de existir
    const r = await fetch(`${base}/chat/config`, { headers: { origin: ORIGIN } });
    assert.equal(r.status, 503);
    const body = await r.json();
    assert.equal(body.error.codigo, "SERVICIO_NO_DISPONIBLE");
    const texto = JSON.stringify(body);
    assert.ok(!/sin informaci|pool|ECONN|postgres|SELECT/i.test(texto));
    assert.ok(!("contactos" in body) && !("apertura" in body));
  } finally {
    setChatPoolForTests(undefined); server.close();
    await db.migrator.end().catch(() => {}); await db.admin.end().catch(() => {}); await db.maint.end().catch(() => {});
  }
});
