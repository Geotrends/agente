/** US1 · RNF-C3-AD-01..06: secretos, bloqueos por cuenta e IP, sesión de 30 min y concurrencia. */
import test from "node:test";
import assert from "node:assert/strict";
import { ACCOUNT_LOCK_MS, IP_LOCK_MS } from "../../src/admin/auth.js";
import { GESTOR, PASSWORD, startAdminApp, TECNICO, type AdminApp } from "./support.js";

let app: AdminApp;
test.before(async () => { app = await startAdminApp(); });
test.after(async () => { await app.close(); });

const MIN = 60_000;
const fail = (email: string, ip = "10.1.0.1", pass = "incorrecta-123456") => app.rawLogin(email, pass, ip);
const reset = async () => {
  await app.db.migrator.query("DELETE FROM admin.login_ip_guard");
  await app.db.migrator.query("UPDATE admin.account SET failed_attempts = 0, locked_until = NULL");
};

test("RNF01: sin sesión → 401 sin datos en rutas protegidas", async () => {
  for (const [m, p] of [["GET", "/accounts"], ["GET", "/contacts"], ["GET", "/status"], ["GET", "/notifications"], ["POST", "/password"], ["GET", "/session"]]) {
    const r = await app.anon(m, p, m === "POST" ? {} : undefined);
    assert.equal(r.status, 401, `${m} ${p}`);
    assert.deepEqual(Object.keys(r.json.error).sort(), ["codigo", "mensaje"]);
  }
});

test("RNF03: tres cuentas con la misma contraseña → PHC distintos argon2id; ninguna contraseña legible en la base ni en respuestas", async () => {
  await app.createAccount("tec.sec@prueba.gov.co", TECNICO);
  const misma = "contraseña-compartida-xyz";
  const emails = ["u1@prueba.gov.co", "u2@prueba.gov.co", "u3@prueba.gov.co"];
  const t = await app.login("tec.sec@prueba.gov.co");
  const respuestas: string[] = [];
  for (const email of emails) {
    const r = await t.api("POST", "/accounts", { nombre: "Igual", email, perfil: GESTOR, password: misma });
    assert.equal(r.status, 201); respuestas.push(r.text);
  }
  const phc = (await app.db.migrator.query("SELECT password_phc FROM admin.account WHERE email = ANY($1)", [emails])).rows.map(r => r.password_phc as string);
  assert.equal(new Set(phc).size, 3);
  for (const h of phc) assert.match(h, /^\$argon2id\$v=19\$m=65536,(t=3,p=1|p=1,t=3)\$/);

  // Operaciones: inicios, cambio propio, temporal y error forzado.
  const s = await app.login("u1@prueba.gov.co", misma);
  respuestas.push((await s.api("POST", "/password", { currentPassword: misma, newPassword: "otra-contraseña-secreta" })).text);
  respuestas.push((await app.rawLogin("u2@prueba.gov.co", "mala-contraseña-123456")).status.toString());
  const id2 = (await app.db.migrator.query("SELECT id, revision FROM admin.account WHERE email = 'u2@prueba.gov.co'")).rows[0];
  respuestas.push((await t.api("POST", `/accounts/${id2.id}/temporary-password`, { expectedRevision: String(id2.revision), password: "temporal-secreta-999" })).text);
  respuestas.push((await t.api("POST", `/accounts/${id2.id}/temporary-password`, { expectedRevision: "1", password: "x" })).text);
  for (const email of ["u3@prueba.gov.co"]) for (let i = 0; i < 5; i++) await fail(email, "10.9.9.9", "mala-secreta-123456");

  const secretos = [misma, "otra-contraseña-secreta", "temporal-secreta-999", "mala-secreta-123456"];
  for (const secreto of secretos) {
    assert.ok(!respuestas.some(r => r.includes(secreto)), `respuesta con ${secreto}`);
    // Búsqueda en todas las columnas de texto de los esquemas admin, chat y kb.
    const cols = (await app.db.migrator.query(
      `SELECT table_schema, table_name, column_name FROM information_schema.columns
        WHERE table_schema IN ('admin','chat','kb') AND data_type IN ('text','character varying','jsonb','json')`)).rows;
    for (const c of cols) {
      const n = (await app.db.migrator.query(
        `SELECT count(*)::int n FROM ${c.table_schema}.${c.table_name} WHERE ${c.column_name}::text LIKE $1`, [`%${secreto}%`])).rows[0].n;
      assert.equal(n, 0, `${c.table_schema}.${c.table_name}.${c.column_name}`);
    }
  }
});

test("RNF02: 11 vs 12 puntos de código al cambiar contraseña", async () => {
  await app.createAccount("len@prueba.gov.co", GESTOR);
  const s = await app.login("len@prueba.gov.co");
  assert.equal((await s.api("POST", "/password", { currentPassword: PASSWORD, newPassword: "abcdefghijk" })).status, 422);
  assert.equal((await s.api("POST", "/password", { currentPassword: PASSWORD, newPassword: "ñandúñandú" })).status, 422);
  assert.equal((await s.api("POST", "/password", { currentPassword: PASSWORD, newPassword: "abcdefghijkl" })).status, 204);
});

test("RNF04: cinco fallos bloquean 15 min (incluida la contraseña correcta), éxito reinicia y se genera un solo aviso", async () => {
  await reset();
  await app.createAccount("bloq@prueba.gov.co", GESTOR);
  const mensajes = new Set<string>();
  // 4 fallos + éxito + 4 fallos: el contador se reinició y no hay bloqueo.
  for (let i = 0; i < 4; i++) { const r = await fail("bloq@prueba.gov.co"); mensajes.add(await r.text()); }
  assert.equal((await app.rawLogin("bloq@prueba.gov.co", PASSWORD, "10.1.0.1")).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await fail("bloq@prueba.gov.co")).status, 401);
  assert.equal((await app.rawLogin("bloq@prueba.gov.co", PASSWORD)).status, 200);

  await reset();
  for (let i = 0; i < 5; i++) { const r = await fail("bloq@prueba.gov.co", `10.2.0.${i + 1}`); assert.equal(r.status, 401); mensajes.add(await r.text()); }
  const inexistente = await fail("nadie@prueba.gov.co", "10.2.1.1"); mensajes.add(await inexistente.text());
  // Misma respuesta para contraseña errónea, cuenta bloqueada e inexistente.
  assert.equal((await app.rawLogin("bloq@prueba.gov.co", PASSWORD, "10.2.2.1")).status, 401, "bloqueada: la correcta también se rechaza");
  mensajes.add(await (await app.rawLogin("bloq@prueba.gov.co", PASSWORD, "10.2.2.2")).text());
  assert.equal(mensajes.size, 1, "mensaje uniforme");

  app.clock.t += 14 * MIN;
  assert.equal((await app.rawLogin("bloq@prueba.gov.co", PASSWORD, "10.2.3.1")).status, 401);
  app.clock.t += 2 * MIN + 1;
  assert.equal(ACCOUNT_LOCK_MS, 15 * MIN);
  assert.equal((await app.rawLogin("bloq@prueba.gov.co", PASSWORD, "10.2.3.2")).status, 200);

  const n = await app.db.migrator.query(
    `SELECT n.type, n.scope, n.repetitions, n.safe_description FROM admin.notification n
       JOIN admin.account a ON a.id::text = n.object_id
      WHERE n.type = 'cuenta_bloqueada' AND a.email = 'bloq@prueba.gov.co'`);
  assert.equal(n.rows.length, 1);
  assert.equal(n.rows[0].scope, "sistema");
  assert.match(n.rows[0].safe_description, /bloq@prueba\.gov\.co/);
  assert.ok(!n.rows[0].safe_description.includes(PASSWORD));
});

test("RNF06: 20 fallos por IP en 15 min → 429 + Retry-After sin verificar credenciales; ventana deslizante; cabecera falsificada no cambia la IP", async () => {
  await reset();
  await app.createAccount("ip@prueba.gov.co", GESTOR);
  // 19 fallos con cuentas distintas (incluso inexistentes): aún no hay bloqueo.
  for (let i = 0; i < 19; i++) {
    // El proxy confiable añade la IP real al final; el cliente antepone valores falsos distintos.
    const r = await app.rawLogin(`noexiste${i}@prueba.gov.co`, "x-incorrecta-123456", `192.0.2.${i}, 10.3.0.1`);
    assert.equal(r.status, 401);
  }
  assert.equal((await app.rawLogin("ip@prueba.gov.co", "mala-123456789012", "198.51.100.7, 10.3.0.1")).status, 401); // 20.º fallo
  const antes = (await app.db.migrator.query("SELECT failed_attempts FROM admin.account WHERE email = 'ip@prueba.gov.co'")).rows[0].failed_attempts;
  const bloqueada = await app.rawLogin("ip@prueba.gov.co", PASSWORD, "203.0.113.9, 10.3.0.1");
  assert.equal(bloqueada.status, 429, "incluso con la contraseña correcta");
  const ra = Number(bloqueada.headers.get("retry-after"));
  assert.ok(Number.isInteger(ra) && ra > 0 && ra <= 900, `Retry-After ${ra}`);
  const despues = (await app.db.migrator.query("SELECT failed_attempts FROM admin.account WHERE email = 'ip@prueba.gov.co'")).rows[0].failed_attempts;
  assert.equal(despues, antes, "no se verificaron credenciales");
  // Otra IP real no está bloqueada.
  assert.equal((await app.rawLogin("ip@prueba.gov.co", PASSWORD, "10.3.0.2")).status, 200);
  // Pasados 15 min vuelve a permitir.
  app.clock.t += IP_LOCK_MS + 1;
  assert.equal((await app.rawLogin("ip@prueba.gov.co", PASSWORD, "10.3.0.1")).status, 200);
});

test("RNF06: la ventana es deslizante (19 fallos + 16 min + 1 no bloquea) y un éxito reinicia el conteo", async () => {
  await reset();
  await app.createAccount("desliza@prueba.gov.co", GESTOR);
  for (let i = 0; i < 19; i++) await fail(`n${i}@prueba.gov.co`, "10.4.0.1");
  app.clock.t += 16 * MIN;
  assert.equal((await fail("n99@prueba.gov.co", "10.4.0.1")).status, 401);
  assert.equal((await app.rawLogin("desliza@prueba.gov.co", PASSWORD, "10.4.0.1")).status, 200);
  const g = (await app.db.migrator.query("SELECT failures, blocked_until FROM admin.login_ip_guard")).rows[0];
  assert.equal(g.failures.length, 0);
  assert.equal(g.blocked_until, null);
});

test("RNF04/06: contadores correctos con intentos concurrentes y persistentes (sin IP en claro)", async () => {
  await reset();
  await app.createAccount("conc@prueba.gov.co", GESTOR);
  // 12 intentos fallidos simultáneos contra la misma cuenta desde IPs distintas: se bloquea una sola vez.
  await Promise.all(Array.from({ length: 12 }, (_, i) => fail("conc@prueba.gov.co", `10.5.0.${i + 1}`)));
  const acc = (await app.db.migrator.query("SELECT failed_attempts, locked_until FROM admin.account WHERE email = 'conc@prueba.gov.co'")).rows[0];
  assert.ok(acc.locked_until, "la cuenta quedó bloqueada");
  const avisos = await app.db.migrator.query(
    `SELECT n.repetitions FROM admin.notification n JOIN admin.account a ON a.id::text = n.object_id
      WHERE n.type = 'cuenta_bloqueada' AND n.state = 'no_revisada' AND a.email = 'conc@prueba.gov.co'`);
  assert.equal(avisos.rows.length, 1);
  assert.equal(avisos.rows[0].repetitions, 1, "un solo bloqueo aunque lleguen intentos simultáneos");

  // 25 fallos simultáneos desde una misma IP: ninguno se pierde → la IP queda bloqueada.
  await reset();
  await Promise.all(Array.from({ length: 25 }, (_, i) => fail(`c${i}@prueba.gov.co`, "10.6.0.1")));
  assert.equal((await app.rawLogin("ip@prueba.gov.co", PASSWORD, "10.6.0.1")).status, 429);
  const filas = (await app.db.migrator.query("SELECT ip_key FROM admin.login_ip_guard")).rows;
  assert.ok(filas.every(f => /^[0-9a-f]{64}$/.test(f.ip_key) && !f.ip_key.includes("10.6.0.1")));
});

test("RNF05: sesión vence a los 30 min sin solicitudes; solicitudes cada 20 min por 90 min la mantienen", async () => {
  await app.createAccount("ses@prueba.gov.co", GESTOR);
  let s = await app.login("ses@prueba.gov.co", PASSWORD, "10.7.0.1");
  app.clock.t += 29 * MIN;
  assert.equal((await s.api("GET", "/session")).status, 200);
  app.clock.t += 31 * MIN;
  const vencida = await s.api("GET", "/session");
  assert.equal(vencida.status, 401);
  assert.ok(!vencida.text.includes("Ana") && !("cuenta" in (vencida.json ?? {})));

  s = await app.login("ses@prueba.gov.co", PASSWORD, "10.7.0.1");
  for (let i = 0; i < 5; i++) {
    app.clock.t += 20 * MIN;
    assert.equal((await s.api("GET", "/session")).status, 200, `minuto ${(i + 1) * 20}`);
  }
  app.clock.t += 31 * MIN;
  assert.equal((await s.api("GET", "/session")).status, 401);
});
