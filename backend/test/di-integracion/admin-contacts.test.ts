import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { createChatAdminDb, type ChatAdminDb } from "./chatAdminDb.js";
import { setAdminPoolForTests } from "../../src/admin/db.js";
import { hashPassword } from "../../src/admin/passwords.js";
import { adminClock } from "../../src/admin/sessions.js";
import { resetIpThrottle } from "../../src/admin/auth.js";
import { readContactSnapshot } from "../../src/admin/contacts.js";
import adminAuthRouter from "../../src/routes/adminAuth.js";
import adminContactsRouter from "../../src/routes/adminContacts.js";

const ORIGIN = "https://panel.ejemplo.gov.co";
process.env.CHAT_ALLOWED_ORIGINS = ORIGIN;

type Ctx = { db: ChatAdminDb; base: string; h: Record<string, string>; hGestor: Record<string, string>; close: () => Promise<void> };

async function start(): Promise<Ctx> {
  const db = await createChatAdminDb();
  setAdminPoolForTests(db.admin);
  resetIpThrottle();
  adminClock.now = () => Date.now();
  const app = express();
  app.use(express.json());
  app.use("/api", adminAuthRouter);
  app.use("/api", adminContactsRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin`;
  for (const [email, perfil] of [["tec@x.co", "administrador técnico"], ["ges@x.co", "Gestor documental"]]) {
    await db.admin.query(`INSERT INTO admin.account (email, display_name, profile, password_phc, must_change_password) VALUES ($1,$1,$2,$3,false)`,
      [email, perfil, await hashPassword("contraseña-larga-123")]);
  }
  const sesion = async (email: string) => {
    const r = await fetch(`${base}/session`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ email, password: "contraseña-larga-123" }) });
    const b = await r.json();
    return { "content-type": "application/json", origin: ORIGIN, cookie: r.headers.get("set-cookie")!.split(";")[0], "x-csrf-token": b.csrfToken };
  };
  return { db, base, h: await sesion("tec@x.co"), hGestor: await sesion("ges@x.co"),
    close: async () => { setAdminPoolForTests(undefined); server.close(); await db.close(); } };
}

const call = (c: Ctx, method: string, path: string, body?: unknown, h = c.h) =>
  fetch(`${c.base}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });

const REC = { pqrsd: "https://pqrsd.ejemplo.gov.co", whatsapp: "+57 (300) 111-2233", email: "pqrsd@ejemplo.gov.co" };
const GEN = { phone: "(604) 555 0100", email: "info@ejemplo.gov.co", url: "https://ejemplo.gov.co/contacto" };

async function revision(c: Ctx): Promise<number> {
  return (await (await call(c, "GET", "/contacts")).json()).revision;
}

test("recepción: 3 ediciones válidas y 5 inválidas, sin perder los tres valores", async () => {
  const c = await start();
  try {
    assert.equal(((await (await call(c, "GET", "/contacts")).json()) as { recepcion: unknown }).recepcion, null, "arranca vacío, sin valores inventados");
    for (let i = 0; i < 3; i++) {
      const r = await call(c, "PUT", "/contacts/reception", { ...REC, whatsapp: `+57 300 111 22${30 + i}`, revision: await revision(c) });
      assert.equal(r.status, 200);
    }
    const invalidos: Array<[Record<string, unknown>, string]> = [
      [{ ...REC, pqrsd: "http://inseguro.example" }, "pqrsd"], [{ ...REC, pqrsd: "" }, "pqrsd"],
      [{ ...REC, whatsapp: "llamar al 300" }, "whatsapp"], [{ ...REC, email: "sin-arroba" }, "email"], [{ ...REC, whatsapp: "+-()" }, "whatsapp"],
    ];
    for (const [cuerpo, campo] of invalidos) {
      const antes = await revision(c);
      const r = await call(c, "PUT", "/contacts/reception", { ...cuerpo, revision: antes });
      assert.equal(r.status, 422);
      const e = await r.json();
      assert.equal(e.error.codigo, "VALIDACION");
      assert.equal(e.error.campo, campo);
      assert.equal(await revision(c), antes, "un rechazo no cambia la revisión");
    }
    const s = (await readContactSnapshot(c.db.admin))!;
    assert.equal(s, null, "aún faltan general e inmediatos: el snapshot no está completo");
    const rec = await c.db.admin.query("SELECT whatsapp FROM admin.contact_reception");
    assert.equal(rec.rows[0].whatsapp, "+57 300 111 2232");
  } finally { await c.close(); }
});

test("general: 4 válidas y 3 inválidas; revisión desactualizada → 409 sin perder la otra edición", async () => {
  const c = await start();
  try {
    for (let i = 0; i < 4; i++) {
      assert.equal((await call(c, "PUT", "/contacts/general", { ...GEN, phone: `(604) 555 010${i}`, revision: await revision(c) })).status, 200);
    }
    for (const mal of [{ ...GEN, phone: "abc" }, { ...GEN, email: "x@" }, { ...GEN, url: "ftp://x" }]) {
      assert.equal((await call(c, "PUT", "/contacts/general", { ...mal, revision: await revision(c) })).status, 422);
    }
    const vieja = await revision(c);
    assert.equal((await call(c, "PUT", "/contacts/general", { ...GEN, phone: "(604) 999 0001", revision: vieja })).status, 200);
    const choque = await call(c, "PUT", "/contacts/general", { ...GEN, phone: "(604) 999 0002", revision: vieja });
    assert.equal(choque.status, 409);
    assert.equal((await c.db.admin.query("SELECT phone FROM admin.contact_general")).rows[0].phone, "(604) 999 0001");
  } finally { await c.close(); }
});

test("inmediatos: 10 acciones (6 válidas, 4 inválidas), orden, último canal protegido y snapshot", async () => {
  const c = await start();
  try {
    await call(c, "PUT", "/contacts/reception", { ...REC, revision: 0 });
    await call(c, "PUT", "/contacts/general", { ...GEN, revision: 1 });
    const nuevo = (i: number) => ({ name: `Canal ${i}`, description: `Descripción ${i}`, type: "teléfono", value: `300 000 000${i}` });
    const ids: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const r = await call(c, "POST", "/contacts/immediate", { ...nuevo(i), revision: await revision(c) });
      assert.equal(r.status, 201);
      ids.push((await r.json()).id);
    }
    // 4 inválidas: descripción de 121, tipo incorrecto, correo mal formado, nombre vacío.
    const malas = [{ ...nuevo(9), description: "x".repeat(121) }, { ...nuevo(9), type: "fax" }, { name: "A", description: "d", type: "correo", value: "no-es-correo" }, { ...nuevo(9), name: "  " }];
    for (const m of malas) assert.equal((await call(c, "POST", "/contacts/immediate", { ...m, revision: await revision(c) })).status, 422);
    assert.equal((await call(c, "POST", "/contacts/immediate", { ...nuevo(9), description: "x".repeat(120), revision: await revision(c) })).status, 201, "120 caracteres es válido");
    // Edición y reorden con lista completa.
    assert.equal((await call(c, "PUT", `/contacts/immediate/${ids[0]}`, { ...nuevo(1), name: "Renombrado", revision: await revision(c) })).status, 200);
    assert.equal((await call(c, "PUT", "/contacts/immediate/order", { ids: [ids[2], ids[1]], revision: await revision(c) })).status, 422, "lista incompleta");
    assert.equal((await call(c, "PUT", "/contacts/immediate/order", { ids: [ids[2], ids[2], ids[1], ids[0]], revision: await revision(c) })).status, 422, "duplicados");
    const lista = (await (await call(c, "GET", "/contacts")).json()).inmediatos.map((i: { id: string }) => i.id);
    assert.equal((await call(c, "PUT", "/contacts/immediate/order", { ids: [...lista].reverse(), revision: await revision(c) })).status, 200);
    const s = (await readContactSnapshot(c.db.chat))!;
    assert.deepEqual(s.inmediatos.map(i => i.id), [...lista].reverse());
    assert.deepEqual(s.inmediatos.map(i => i.position), [1, 2, 3, 4]);
    // Eliminar hasta que quede uno; el último no se puede.
    for (const id of s.inmediatos.slice(1).map(i => i.id)) {
      assert.equal((await call(c, "DELETE", `/contacts/immediate/${id}`, { revision: await revision(c) })).status, 200);
    }
    const ultimo = (await readContactSnapshot(c.db.chat))!.inmediatos[0];
    const r = await call(c, "DELETE", `/contacts/immediate/${ultimo.id}`, { revision: await revision(c) });
    assert.equal(r.status, 422);
    assert.equal((await readContactSnapshot(c.db.chat))!.inmediatos.length, 1);
  } finally { await c.close(); }
});

test("mutación y auditoría son atómicas; Gestor y sin sesión no ven ni cambian nada", async () => {
  const c = await start();
  try {
    await call(c, "PUT", "/contacts/reception", { ...REC, revision: 0 });
    const aud = await c.db.admin.query("SELECT action, result FROM admin.audit WHERE action LIKE 'contactos.%'");
    assert.deepEqual(aud.rows, [{ action: "contactos.recepcion.editar", result: "ok" }]);

    // Si la auditoría falla, la edición no queda aplicada.
    await c.db.migrator.query("SET ROLE chat_owner; ALTER TABLE admin.audit ADD CONSTRAINT solo_ok CHECK (action <> 'contactos.general.editar')");
    const antes = await revision(c);
    assert.equal((await call(c, "PUT", "/contacts/general", { ...GEN, revision: antes })).status, 500);
    assert.equal(await revision(c), antes);
    assert.equal((await c.db.admin.query("SELECT count(*)::int n FROM admin.contact_general")).rows[0].n, 0);

    for (const [m, p] of [["GET", "/contacts"], ["PUT", "/contacts/reception"], ["POST", "/contacts/immediate"]] as const) {
      const r = await call(c, m, p, m === "GET" ? undefined : { ...REC, revision: 1 }, c.hGestor);
      assert.equal(r.status, 403);
      assert.ok(!(await r.text()).includes("pqrsd"));
    }
    assert.equal((await fetch(`${c.base}/contacts`)).status, 401);
    assert.equal((await fetch(`${c.base}/contacts/reception`, { method: "PUT", headers: { "content-type": "application/json", origin: ORIGIN }, body: "{}" })).status, 401);
  } finally { await c.close(); }
});
