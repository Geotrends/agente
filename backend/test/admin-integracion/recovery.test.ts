/** US1 · AD-12/13 y RNF-C3-AD-03: recuperación reservada fuera del panel. */
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { recoverPassword } from "../../src/admin/recovery.js";
import { GESTOR, startAdminApp, TECNICO } from "./support.js";

test("AD12/13: recuperación reservada — solo el correo indicado, cambio forzado, auditoría y rol real; el runtime no puede ejecutarla", async () => {
  const a = await startAdminApp();
  try {
    const idT = await a.createAccount("geotrends@prueba.gov.co", TECNICO, { name: "Geotrends" });
    const idG = await a.createAccount("gestor.r@prueba.gov.co", GESTOR);
    const idD = await a.createAccount("desactivada@prueba.gov.co", GESTOR, { active: false });
    await a.createAccount("otro.tec@prueba.gov.co", TECNICO);
    const viva = await a.login("gestor.r@prueba.gov.co");
    const antes = (await a.db.migrator.query("SELECT id, password_phc, profile, active, must_change_password FROM admin.account ORDER BY email")).rows;

    // Parámetros exactos: dos.
    const proc = await a.db.migrator.query("SELECT pronargs FROM pg_proc WHERE proname = 'recover_password' AND pronamespace = 'admin'::regnamespace");
    assert.deepEqual(proc.rows.map(r => r.pronargs), [2]);

    // El runtime y los demás roles no ejecutan el procedimiento.
    for (const rol of ["admin_app", "chat_app", "chat_maint", "app_reader", "kb_writer"]) {
      const c = await a.db.migrator.connect();
      try {
        await c.query(`SET ROLE ${rol}`);
        await assert.rejects(c.query("CALL admin.recover_password('gestor.r@prueba.gov.co', '$argon2id$v=19$m=1,t=1,p=1$x$y')"), /permission denied/, rol);
      } finally { await c.query("RESET ROLE").catch(() => {}); c.release(); }
    }

    // Rol reservado con login de prueba.
    await a.db.migrator.query("ALTER ROLE contractor_recovery LOGIN PASSWORD 'recuperacion-pruebas-123'");
    const u = new URL(a.db.migratorUrl); u.username = "contractor_recovery"; u.password = "recuperacion-pruebas-123";
    const pool = new pg.Pool({ connectionString: u.toString(), max: 1 });
    try {
      const ok = await recoverPassword(pool, "GESTOR.R@prueba.gov.co", "temporal-recuperada-1");
      assert.deepEqual(ok, { ok: true });
      const despues = (await a.db.migrator.query("SELECT id, password_phc, profile, active, must_change_password FROM admin.account ORDER BY email")).rows;
      const cambiadas = despues.filter((r, i) => JSON.stringify(r) !== JSON.stringify(antes[i]));
      assert.deepEqual(cambiadas.map(r => r.id), [idG], "solo cambia la cuenta indicada");
      assert.equal(cambiadas[0].must_change_password, true);
      assert.match(cambiadas[0].password_phc, /^\$argon2id\$/);
      assert.equal((await viva.api("GET", "/session")).status, 401, "revoca sesiones");
      assert.equal((await a.rawLogin("gestor.r@prueba.gov.co", "temporal-recuperada-1")).status, 200);

      // Desactivada: se actualiza la contraseña pero NO se activa ni cambia de perfil.
      assert.deepEqual(await recoverPassword(pool, "desactivada@prueba.gov.co", "temporal-recuperada-2"), { ok: true });
      const d = (await a.db.migrator.query("SELECT active, profile FROM admin.account WHERE id = $1", [idD])).rows[0];
      assert.deepEqual(d, { active: false, profile: GESTOR });

      // Correo inexistente: error, nada cambia y queda auditoría segura del error.
      const snapshot = JSON.stringify((await a.db.migrator.query("SELECT * FROM admin.account ORDER BY email")).rows);
      assert.deepEqual(await recoverPassword(pool, "noexiste@prueba.gov.co", "temporal-recuperada-3"), { ok: false, reason: "cuenta_inexistente" });
      assert.equal(JSON.stringify((await a.db.migrator.query("SELECT * FROM admin.account ORDER BY email")).rows), snapshot);
      // Contraseña corta: ni se llama al procedimiento.
      assert.deepEqual(await recoverPassword(pool, "gestor.r@prueba.gov.co", "corta"), { ok: false, reason: "contrasena_no_valida" });
    } finally { await pool.end(); }

    const aud = (await a.db.migrator.query(
      "SELECT actor_account_id, actor_db_role, result, object_id FROM admin.audit WHERE action = 'cuenta.recuperacion' ORDER BY id")).rows;
    assert.deepEqual(aud.map(r => [r.actor_db_role, r.result]), [["contractor_recovery", "ok"], ["contractor_recovery", "ok"], ["contractor_recovery", "error"]]);
    assert.ok(aud.every(r => r.actor_account_id === null));
    assert.equal(aud[0].object_id, idG);
    void idT;
  } finally { await a.close(); }
});
