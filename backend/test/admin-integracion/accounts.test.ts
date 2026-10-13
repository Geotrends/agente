/** US1 · AD-05..13: cuentas, perfiles, contraseñas temporales y recuperación reservada. */
import test from "node:test";
import assert from "node:assert/strict";
import { GESTOR, PASSWORD, startAdminApp, TECNICO, type AdminApp } from "./support.js";

let app: AdminApp;
test.before(async () => { app = await startAdminApp(); });
test.after(async () => { await app.close(); });

const body = (o: Record<string, unknown> = {}) => ({ nombre: "Persona Prueba", email: "nueva@prueba.gov.co", perfil: GESTOR, password: "clave-inicial-123", ...o });

test("AD05: alta válida sin secretos; faltantes y correo repetido indican el campo; nombre repetible", async () => {
  await app.createAccount("tec.alta@prueba.gov.co", TECNICO);
  const t = await app.login("tec.alta@prueba.gov.co");
  const ok = await t.api("POST", "/accounts", body());
  assert.equal(ok.status, 201);
  assert.equal(ok.json.email, "nueva@prueba.gov.co");
  assert.equal(ok.json.perfil, GESTOR);
  assert.equal(ok.json.cambioObligatorio, true);
  assert.equal(ok.json.activa, true);
  assert.match(ok.json.revision, /^[1-9][0-9]*$/);
  assert.ok(!/password|phc|argon/i.test(ok.text), "la respuesta no lleva secretos");

  for (const campo of ["nombre", "email", "perfil", "password"]) {
    const { [campo]: _omit, ...resto } = body({ email: `x-${campo}@prueba.gov.co` }) as Record<string, unknown>;
    const r = await t.api("POST", "/accounts", resto);
    assert.equal(r.status, 422, campo);
    assert.equal(r.json.error.campo, campo);
  }
  const dup = await t.api("POST", "/accounts", body({ email: "  NUEVA@prueba.gov.co " }));
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error.campo, "email");
  // El nombre no es único.
  assert.equal((await t.api("POST", "/accounts", body({ email: "otra@prueba.gov.co" }))).status, 201);
  // Perfil fuera de la lista y campos desconocidos se rechazan.
  assert.equal((await t.api("POST", "/accounts", body({ email: "p@prueba.gov.co", perfil: "Superusuario" }))).status, 422);
  assert.equal((await t.api("POST", "/accounts", body({ email: "q@prueba.gov.co", active: false }))).status, 422);
});

test("AD05: contraseña inicial menor de 12 puntos de código se rechaza con el mínimo; 12 emojis se aceptan", async () => {
  const t = await app.login("tec.alta@prueba.gov.co");
  const corta = await t.api("POST", "/accounts", body({ email: "c1@prueba.gov.co", password: "a".repeat(11) }));
  assert.equal(corta.status, 422);
  assert.match(corta.json.error.mensaje, /12/);
  assert.equal((await t.api("POST", "/accounts", body({ email: "c2@prueba.gov.co", password: "😀".repeat(11) }))).status, 422);
  assert.equal((await t.api("POST", "/accounts", body({ email: "c3@prueba.gov.co", password: "😀".repeat(12) }))).status, 201);
  assert.equal((await t.api("POST", "/accounts", body({ email: "c4@prueba.gov.co", password: " ".repeat(12) }))).status, 201, "sin recorte ni composición");
});

test("el Gestor recibe 403 sin datos en todas las rutas de cuentas", async () => {
  const gid = await app.createAccount("gestor.403@prueba.gov.co", GESTOR);
  const g = await app.login("gestor.403@prueba.gov.co");
  for (const [m, p, b] of [["GET", "/accounts"], ["POST", "/accounts", body({ email: "g@prueba.gov.co" })],
    ["PATCH", `/accounts/${gid}`, { expectedRevision: "1", active: false }],
    ["POST", `/accounts/${gid}/temporary-password`, { expectedRevision: "1", password: "temporal-larga-123" }]] as const) {
    const r = await g.api(m, p, b);
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.ok(!/@prueba|argon/.test(r.text));
  }
});

test("AD06/07: desactivar cierra sesiones y rechaza inicio; reactivar exige nuevo inicio; historia intacta", async () => {
  await app.createAccount("tec.des@prueba.gov.co", TECNICO);
  const objetivo = await app.createAccount("objetivo@prueba.gov.co", GESTOR);
  const t = await app.login("tec.des@prueba.gov.co");
  const viva = await app.login("objetivo@prueba.gov.co");
  assert.equal((await viva.api("GET", "/session")).status, 200);
  const lista = await t.api("GET", "/accounts");
  const rev = lista.json.items.find((a: { id: string }) => a.id === objetivo).revision;

  const des = await t.api("PATCH", `/accounts/${objetivo}`, { expectedRevision: rev, active: false });
  assert.equal(des.status, 200);
  assert.equal(des.json.activa, false);
  assert.equal(des.json.perfil, GESTOR);
  assert.equal((await viva.api("GET", "/session")).status, 401, "la sesión se cierra desde la siguiente solicitud");
  assert.equal((await app.rawLogin("objetivo@prueba.gov.co", PASSWORD)).status, 401);

  const reac = await t.api("PATCH", `/accounts/${objetivo}`, { expectedRevision: des.json.revision, active: true });
  assert.equal(reac.status, 200);
  assert.equal(reac.json.perfil, GESTOR, "restituye el perfil anterior");
  assert.equal((await viva.api("GET", "/session")).status, 401, "reactivar no revive sesiones");
  assert.equal((await app.rawLogin("objetivo@prueba.gov.co", PASSWORD)).status, 200, "nuevo inicio de sesión");
  const { rows } = await app.db.migrator.query("SELECT count(*)::int n FROM admin.account WHERE id = $1", [objetivo]);
  assert.equal(rows[0].n, 1);
  const aud = await app.db.migrator.query("SELECT action FROM admin.audit WHERE object_id = $1 ORDER BY id", [objetivo]);
  assert.deepEqual(aud.rows.map(r => r.action).filter(a => a.startsWith("cuenta.") && a !== "cuenta.bloqueo"), ["cuenta.desactivar", "cuenta.reactivar"]);
});

test("revisión obsoleta → 409 sin cambios; cuenta inexistente → 404; sin cambio permitido → 422", async () => {
  const id = await app.createAccount("rev@prueba.gov.co", GESTOR);
  const t = await app.login("tec.des@prueba.gov.co");
  const stale = await t.api("PATCH", `/accounts/${id}`, { expectedRevision: "99", active: false });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error.codigo, "REVISION_OBSOLETA");
  assert.equal((await app.db.migrator.query("SELECT active FROM admin.account WHERE id = $1", [id])).rows[0].active, true);
  assert.equal((await t.api("PATCH", "/accounts/00000000-0000-4000-8000-000000000000", { expectedRevision: "1", active: false })).status, 404);
  assert.equal((await t.api("PATCH", `/accounts/${id}`, { expectedRevision: "1" })).status, 422);
  assert.equal((await t.api("PATCH", `/accounts/${id}`, { expectedRevision: 1, active: false })).status, 422, "la revisión es una cadena decimal");
});

test("AD10/11: temporal para otra cuenta; propia, corta o de Gestor se rechazan; el cambio obligatorio limita el acceso", async () => {
  await app.createAccount("tec.temp@prueba.gov.co", TECNICO);
  const objetivo = await app.createAccount("temp.obj@prueba.gov.co", GESTOR);
  const t = await app.login("tec.temp@prueba.gov.co");
  const viva = await app.login("temp.obj@prueba.gov.co");
  const lst = (await t.api("GET", "/accounts")).json.items as Array<{ id: string; revision: string }>;
  const rev = lst.find(a => a.id === objetivo)!.revision;

  const corta = await t.api("POST", `/accounts/${objetivo}/temporary-password`, { expectedRevision: rev, password: "corta" });
  assert.equal(corta.status, 422);
  assert.match(corta.json.error.mensaje, /12/);
  const propia = await t.api("POST", `/accounts/${t.accountId}/temporary-password`, { expectedRevision: "1", password: "temporal-larga-123" });
  assert.equal(propia.status, 422);

  const ok = await t.api("POST", `/accounts/${objetivo}/temporary-password`, { expectedRevision: rev, password: "temporal-larga-123" });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.cambioObligatorio, true);
  assert.ok(!/temporal-larga|argon/.test(ok.text));
  assert.equal((await viva.api("GET", "/session")).status, 401, "revoca sesiones");

  const g = await app.login("temp.obj@prueba.gov.co", "temporal-larga-123");
  assert.equal((await g.api("GET", "/session")).status, 200);
  const bloqueado = await g.api("GET", "/notifications");
  assert.equal(bloqueado.status, 403);
  assert.equal(bloqueado.json.error.codigo, "CAMBIO_CONTRASENA_REQUERIDO");
  const igual = await g.api("POST", "/password", { currentPassword: "temporal-larga-123", newPassword: "temporal-larga-123" });
  assert.equal(igual.status, 422);
  const corta2 = await g.api("POST", "/password", { currentPassword: "temporal-larga-123", newPassword: "corta" });
  assert.equal(corta2.status, 422);
  const cambio = await g.api("POST", "/password", { currentPassword: "temporal-larga-123", newPassword: "definitiva-larga-456" });
  assert.equal(cambio.status, 204);
  assert.equal((await app.rawLogin("temp.obj@prueba.gov.co", "definitiva-larga-456")).status, 200);

  // El Gestor no asigna temporales.
  const gs = await app.login("temp.obj@prueba.gov.co", "definitiva-larga-456");
  assert.equal((await gs.api("POST", `/accounts/${objetivo}/temporary-password`, { expectedRevision: "1", password: "temporal-larga-123" })).status, 403);
});

test("AD09: cambio propio exige contraseña actual; si es incorrecta no se modifica nada", async () => {
  const id = await app.createAccount("propio@prueba.gov.co", GESTOR);
  const s = await app.login("propio@prueba.gov.co");
  const antes = (await app.db.migrator.query("SELECT password_phc FROM admin.account WHERE id = $1", [id])).rows[0].password_phc;
  const mala = await s.api("POST", "/password", { currentPassword: "equivocada-123456", newPassword: "nueva-larga-contraseña" });
  assert.equal(mala.status, 422);
  assert.equal(mala.json.error.campo, "currentPassword");
  assert.equal((await app.db.migrator.query("SELECT password_phc FROM admin.account WHERE id = $1", [id])).rows[0].password_phc, antes);
  assert.equal((await s.api("POST", "/password", { currentPassword: PASSWORD, newPassword: "nueva-larga-contraseña" })).status, 204);
  assert.equal((await s.api("GET", "/session")).status, 200, "la sesión propia se conserva");
});

