import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import express from "express";
import { createChatAdminDb, type ChatAdminDb } from "./chatAdminDb.js";
import { setAdminPoolForTests } from "../../src/admin/db.js";
import { hashPassword } from "../../src/admin/passwords.js";
import { adminClock } from "../../src/admin/sessions.js";
import { resetIpThrottle } from "../../src/admin/auth.js";
import adminAuthRouter, { requireAdmin } from "../../src/routes/adminAuth.js";

const ORIGIN = "https://panel.ejemplo.gov.co";
process.env.CHAT_ALLOWED_ORIGINS = ORIGIN;

type Ctx = { db: ChatAdminDb; base: string; close: () => Promise<void>; clock: { t: number } };

async function start(): Promise<Ctx> {
  const db = await createChatAdminDb();
  setAdminPoolForTests(db.admin);
  resetIpThrottle();
  const clock = { t: Date.UTC(2026, 9, 8, 12, 0, 0) };
  adminClock.now = () => clock.t;
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api", adminAuthRouter);
  app.get("/api/admin/secreto", requireAdmin({ perfil: "administrador técnico" }), (_req, res) => res.json({ dato: "x" }));
  app.post("/api/admin/mutar", requireAdmin({ perfil: "administrador técnico", mutation: true }), (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin`;
  return {
    db, base, clock,
    close: async () => { adminClock.now = () => Date.now(); setAdminPoolForTests(undefined); server.close(); await db.close(); },
  };
}

async function addAccount(db: ChatAdminDb, email: string, password: string, opts: { perfil?: string; must?: boolean } = {}): Promise<string> {
  const { rows } = await db.admin.query(
    `INSERT INTO admin.account (email, display_name, profile, password_phc, must_change_password)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [email, email, opts.perfil ?? "administrador técnico", await hashPassword(password), opts.must ?? false]);
  return rows[0].id;
}

const headers = (extra: Record<string, string> = {}) => ({ "content-type": "application/json", origin: ORIGIN, ...extra });

async function login(c: Ctx, email: string, password: string, ip = "10.0.0.1") {
  const res = await fetch(`${c.base}/session`, {
    method: "POST", headers: headers({ "x-forwarded-for": ip }), body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  return { res, body, cookie, csrf: body.csrfToken as string | undefined };
}

test("argon2id con sal única y parámetros documentados", async () => {
  const a = await hashPassword("una-contraseña-larga");
  const b = await hashPassword("una-contraseña-larga");
  assert.match(a, /^\$argon2id\$v=19\$m=65536,p=1,t=3\$/);
  assert.notEqual(a, b);
});

test("el último administrador técnico se protege ante operaciones concurrentes", async () => {
  const c = await start();
  try {
    const a = await addAccount(c.db, "a@x.co", "contraseña-larga-1");
    const b = await addAccount(c.db, "b@x.co", "contraseña-larga-2");
    const desactivar = async (id: string) => {
      const cl = await c.db.admin.connect();
      try {
        await cl.query("BEGIN");
        await cl.query("UPDATE admin.account SET active = false WHERE id = $1", [id]);
        await new Promise(r => setTimeout(r, 100));
        await cl.query("COMMIT");
        return "ok";
      } catch { await cl.query("ROLLBACK").catch(() => {}); return "rechazada"; } finally { cl.release(); }
    };
    const res = await Promise.all([desactivar(a), desactivar(b)]);
    assert.deepEqual(res.sort(), ["ok", "rechazada"]);
    const { rows } = await c.db.admin.query("SELECT count(*)::int AS n FROM admin.account WHERE active AND profile = 'administrador técnico'");
    assert.equal(rows[0].n, 1);
  } finally { await c.close(); }
});

test("la auditoría es append-only y no hay borrado de cuentas", async () => {
  const c = await start();
  try {
    await c.db.admin.query("INSERT INTO admin.audit (action, object_type, result) VALUES ('x','y','ok')");
    await assert.rejects(c.db.admin.query("UPDATE admin.audit SET result = 'z'"), /permission denied/i);
    await assert.rejects(c.db.admin.query("DELETE FROM admin.audit"), /permission denied/i);
    await assert.rejects(c.db.admin.query("DELETE FROM admin.account"), /permission denied/i);
    // Ni siquiera el propietario puede reescribirla: lo impide el disparador.
    await assert.rejects(c.db.migrator.query("SET ROLE chat_owner; DELETE FROM admin.audit"), /solo anexado/);
  } finally { await c.close(); }
});

test("el bootstrap lee la contraseña por stdin y no la filtra", async () => {
  const c = await start();
  try {
    const secreto = "temporal-super-secreta-99";
    const url = new URL(c.db.migratorUrl);
    url.username = "admin_app"; url.password = "admin-app-pruebas-123";
    const out = await new Promise<{ code: number | null; text: string }>(resolve => {
      const p = spawn(process.execPath, ["--import", "tsx", "scripts/bootstrap-admin.ts", "Boot@Ejemplo.co", "Admin Inicial"],
        { env: { ...process.env, ADMIN_DATABASE_URL: url.toString() } });
      let text = "";
      p.stdout.on("data", d => (text += d)); p.stderr.on("data", d => (text += d));
      p.on("close", code => resolve({ code, text }));
      p.stdin.end(secreto + "\n");
    });
    assert.equal(out.code, 0, out.text);
    assert.ok(!out.text.includes(secreto));
    const { rows } = await c.db.admin.query("SELECT password_phc, must_change_password FROM admin.account WHERE email = 'boot@ejemplo.co'");
    assert.equal(rows[0].must_change_password, true);
    assert.ok(!rows[0].password_phc.includes(secreto));
  } finally { await c.close(); }
});

test("login: 401 idéntico, bloqueo de cuenta 5/15 min y cookie segura", async () => {
  const c = await start();
  try {
    await addAccount(c.db, "t@x.co", "contraseña-correcta-1");
    const ok = await login(c, "t@x.co", "contraseña-correcta-1", "10.0.0.2");
    assert.equal(ok.res.status, 200);
    assert.match(ok.res.headers.get("set-cookie")!, /HttpOnly; Secure; SameSite=Strict/);
    assert.ok(!JSON.stringify(ok.body).includes("argon2"));

    const noExiste = await login(c, "nadie@x.co", "x", "10.0.0.3");
    const mala = await login(c, "t@x.co", "mala", "10.0.0.3");
    assert.equal(noExiste.res.status, 401);
    assert.deepEqual(noExiste.body, mala.body);

    for (let i = 0; i < 4; i++) await login(c, "t@x.co", "mala", "10.0.0.4");
    const bloqueada = await login(c, "t@x.co", "contraseña-correcta-1", "10.0.0.5");
    assert.equal(bloqueada.res.status, 401, "la quinta falla bloquea aunque luego llegue la clave correcta");
    assert.deepEqual(bloqueada.body, mala.body);
    c.clock.t += 14 * 60_000;
    assert.equal((await login(c, "t@x.co", "contraseña-correcta-1", "10.0.0.6")).res.status, 401);
    c.clock.t += 2 * 60_000;
    assert.equal((await login(c, "t@x.co", "contraseña-correcta-1", "10.0.0.6")).res.status, 200);
  } finally { await c.close(); }
});

test("IP: 20 fallos bloquean 15 min antes de verificar; 19+éxito+5 no bloquea", async () => {
  const c = await start();
  try {
    await addAccount(c.db, "ip@x.co", "contraseña-correcta-1");
    const ip = "10.1.1.1";
    for (let i = 0; i < 19; i++) await login(c, `inexistente${i}@x.co`, "x", ip);
    assert.equal((await login(c, "ip@x.co", "contraseña-correcta-1", ip)).res.status, 200);
    for (let i = 0; i < 5; i++) assert.equal((await login(c, `otro${i}@x.co`, "x", ip)).res.status, 401);

    const ip2 = "10.1.1.2";
    for (let i = 0; i < 20; i++) await login(c, `inexistente${i}@x.co`, "x", ip2);
    const bloqueado = await login(c, "ip@x.co", "contraseña-correcta-1", ip2);
    assert.equal(bloqueado.res.status, 429, "la clave correcta no se verifica mientras la IP está bloqueada");
    assert.ok(Number(bloqueado.res.headers.get("retry-after")) > 0);
    c.clock.t += 16 * 60_000;
    assert.equal((await login(c, "ip@x.co", "contraseña-correcta-1", ip2)).res.status, 200);
  } finally { await c.close(); }
});

test("sesión de 30 min por solicitudes reales (29 vs 31 min) y revocación inmediata", async () => {
  const c = await start();
  try {
    await addAccount(c.db, "s@x.co", "contraseña-correcta-1");
    const l = await login(c, "s@x.co", "contraseña-correcta-1", "10.2.0.1");
    const get = () => fetch(`${c.base}/session`, { headers: { cookie: l.cookie! } });
    c.clock.t += 29 * 60_000;
    assert.equal((await get()).status, 200);
    c.clock.t += 29 * 60_000; // el sondeo anterior renovó la actividad
    assert.equal((await get()).status, 200);
    c.clock.t += 31 * 60_000;
    const expirada = await get();
    assert.equal(expirada.status, 401);
    assert.ok(!(JSON.stringify(await expirada.json())).includes("s@x.co"));

    const l2 = await login(c, "s@x.co", "contraseña-correcta-1", "10.2.0.1");
    const del = await fetch(`${c.base}/session`, { method: "DELETE", headers: headers({ cookie: l2.cookie!, "x-csrf-token": l2.csrf! }) });
    assert.equal(del.status, 204);
    assert.equal((await fetch(`${c.base}/session`, { headers: { cookie: l2.cookie! } })).status, 401);
  } finally { await c.close(); }
});

test("CSRF, Origin y perfiles: Gestor recibe 403 sin datos", async () => {
  const c = await start();
  try {
    await addAccount(c.db, "tec@x.co", "contraseña-correcta-1");
    await addAccount(c.db, "ges@x.co", "contraseña-correcta-2", { perfil: "Gestor documental" });
    const t = await login(c, "tec@x.co", "contraseña-correcta-1", "10.3.0.1");
    const g = await login(c, "ges@x.co", "contraseña-correcta-2", "10.3.0.2");

    assert.equal((await fetch(`${c.base}/secreto`, { headers: { cookie: t.cookie! } })).status, 200);
    const gr = await fetch(`${c.base}/secreto`, { headers: { cookie: g.cookie! } });
    assert.equal(gr.status, 403);
    assert.ok(!(await gr.text()).includes("dato"));
    assert.equal((await fetch(`${c.base}/secreto`)).status, 401);

    const post = (extra: Record<string, string>) => fetch(`${c.base}/mutar`, { method: "POST", headers: headers({ cookie: t.cookie!, ...extra }), body: "{}" });
    assert.equal((await post({})).status, 403, "sin CSRF");
    assert.equal((await post({ "x-csrf-token": "otro" })).status, 403);
    assert.equal((await post({ "x-csrf-token": t.csrf!, origin: "https://malo.example" })).status, 403);
    assert.equal((await post({ "x-csrf-token": t.csrf! })).status, 200);
  } finally { await c.close(); }
});

test("cambio obligatorio: solo sesión/contraseña/logout hasta reemplazar la temporal", async () => {
  const c = await start();
  try {
    await addAccount(c.db, "nuevo@x.co", "temporal-larga-123", { must: true });
    const l = await login(c, "nuevo@x.co", "temporal-larga-123", "10.4.0.1");
    assert.equal(l.body.mustChangePassword, true);
    assert.equal((await fetch(`${c.base}/session`, { headers: { cookie: l.cookie! } })).status, 200);
    assert.equal((await fetch(`${c.base}/secreto`, { headers: { cookie: l.cookie! } })).status, 403);

    const cambiar = (current: string, nuevo: string) => fetch(`${c.base}/password`, {
      method: "POST", headers: headers({ cookie: l.cookie!, "x-csrf-token": l.csrf! }),
      body: JSON.stringify({ currentPassword: current, newPassword: nuevo }) });
    assert.equal((await cambiar("incorrecta-larga-1", "nueva-contraseña-123")).status, 422);
    assert.equal((await cambiar("temporal-larga-123", "corta")).status, 422);
    assert.equal((await cambiar("temporal-larga-123", "temporal-larga-123")).status, 422);
    assert.equal((await cambiar("temporal-larga-123", "nueva-contraseña-123")).status, 204);
    assert.equal((await fetch(`${c.base}/secreto`, { headers: { cookie: l.cookie! } })).status, 200);
    assert.equal((await login(c, "nuevo@x.co", "temporal-larga-123", "10.4.0.2")).res.status, 401);
    assert.equal((await login(c, "nuevo@x.co", "nueva-contraseña-123", "10.4.0.2")).res.status, 200);
  } finally { await c.close(); }
});
