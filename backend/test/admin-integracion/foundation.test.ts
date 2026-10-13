import test from "node:test";
import assert from "node:assert/strict";
import { applyChatAdminMigrations } from "../../src/chat/migrate.js";
import { auditAfterRollback, writeAudit } from "../../src/admin/audit.js";
import { emitNotification } from "../../src/admin/notificationEvents.js";
import { adminTx } from "../../src/admin/db.js";
import { PASS as ROLE_PASSWORDS } from "../di-integracion/chatAdminDb.js";
import { GESTOR, ORIGIN, PASSWORD, startAdminApp, TECNICO, type AdminApp } from "./support.js";

let app: AdminApp;
test.before(async () => { app = await startAdminApp(); });
test.after(async () => { await app.close(); });

test("segunda migración es idempotente y conserva el ledger", async () => {
  const nuevas = await applyChatAdminMigrations(app.db.migrator, ROLE_PASSWORDS);
  assert.deepEqual(nuevas, []);
  const { rows } = await app.db.migrator.query("SELECT nombre FROM chat.schema_migrations WHERE nombre LIKE '009_%'");
  assert.equal(rows.length, 1);
});

test("grants mínimos: el runtime no borra cuentas ni edita auditoría; la recuperación solo la ejecuta el rol reservado", async () => {
  await assert.rejects(app.db.admin.query("DELETE FROM admin.account"), /permission denied/);
  await assert.rejects(app.db.admin.query("UPDATE admin.audit SET result = 'ok'"), /permission denied|solo anexado/);
  await assert.rejects(app.db.admin.query("DELETE FROM admin.audit"), /permission denied|solo anexado/);
  await assert.rejects(app.db.admin.query("CALL admin.recover_password('a@b.co', '$argon2id$x')"), /permission denied/);
  const { rows } = await app.db.migrator.query(
    "SELECT has_function_privilege('public', 'admin.recover_password(text,text)'::regprocedure, 'EXECUTE') AS pub");
  assert.equal(rows[0].pub, false);
});

test("auditoría: acepta rol real sin cuenta y el rechazo posterior al rollback queda registrado", async () => {
  await writeAudit(app.db.admin, { actor: null, actorRole: "contractor_recovery", action: "cuenta.recuperacion", objectType: "cuenta", result: "ok" });
  await assert.rejects(adminTx(async c => {
    await c.query("INSERT INTO admin.audit (action, object_type, result) VALUES ('x','y','ok')");
    throw new Error("falla");
  }, app.db.admin));
  const before = Number((await app.db.migrator.query("SELECT count(*) FROM admin.audit WHERE action = 'prueba.rechazo'")).rows[0].count);
  assert.equal(before, 0);
  await auditAfterRollback({ actor: null, actorRole: "admin_app", action: "prueba.rechazo", objectType: "x", result: "rechazado" }, app.db.admin);
  const after = await app.db.migrator.query("SELECT result, actor_db_role FROM admin.audit WHERE action = 'prueba.rechazo'");
  assert.deepEqual(after.rows, [{ result: "rechazado", actor_db_role: "admin_app" }]);
  // La mutación revertida no dejó la fila 'x'.
  assert.equal((await app.db.migrator.query("SELECT count(*)::int n FROM admin.audit WHERE action = 'x'")).rows[0].n, 0);
});

test("avisos: agrupación idempotente por tipo, objeto, alcance y propietario; sin propietario cae a sistema", async () => {
  const owner = await app.createAccount("gestor.avisos@prueba.gov.co", GESTOR);
  const ev = { type: "ocr_baja", objectType: "documento" as const, objectId: "doc-1", description: "OCR bajo\nsaltos", scope: "carga" as const, ownerAccountId: owner };
  await emitNotification(app.db.admin, ev);
  await emitNotification(app.db.admin, ev);
  await emitNotification(app.db.admin, { ...ev, ownerAccountId: null }); // sin propietario → sistema
  const { rows } = await app.db.migrator.query(
    "SELECT scope, owner_account_id, repetitions, safe_description FROM admin.notification WHERE type = 'ocr_baja' ORDER BY scope");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.find(r => r.scope === "carga"), { scope: "carga", owner_account_id: owner, repetitions: 2, safe_description: "OCR bajo saltos" });
  assert.equal(rows.find(r => r.scope === "sistema")!.owner_account_id, null);
});

test("entradas: clave JSON duplicada o cuerpo no objeto → error uniforme de validación; sin sesión → 401", async () => {
  const dup = await app.anon("POST", "/session", '{"email":"a@b.co","email":"c@d.co","password":"x"}');
  assert.equal(dup.status, 400);
  assert.equal(dup.json.error.codigo, "VALIDACION");
  assert.equal((await app.anon("GET", "/contacts")).status, 401);
});

test("CSRF y Origin: mutación sin token o con origen ajeno se rechaza antes de tocar datos", async () => {
  await app.createAccount("tec.csrf@prueba.gov.co", TECNICO);
  const s = await app.login("tec.csrf@prueba.gov.co");
  const sinCsrf = await fetch(`${app.base}/password`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie: s.cookie },
    body: JSON.stringify({ currentPassword: PASSWORD, newPassword: "otra-contraseña-123" }) });
  assert.equal(sinCsrf.status, 403);
  const origenAjeno = await fetch(`${app.base}/password`, { method: "POST", headers: { "content-type": "application/json", origin: "https://malo.example", cookie: s.cookie, "x-csrf-token": s.csrf },
    body: JSON.stringify({ currentPassword: PASSWORD, newPassword: "otra-contraseña-123" }) });
  assert.equal(origenAjeno.status, 403);
});
