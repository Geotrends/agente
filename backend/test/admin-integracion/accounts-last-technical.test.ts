/** US1 · AD-08: invariante del último administrador técnico, también ante concurrencia. */
import test from "node:test";
import assert from "node:assert/strict";
import { GESTOR, startAdminApp, TECNICO, type AdminApp } from "./support.js";

let a: AdminApp;
test.before(async () => { a = await startAdminApp(); });
test.after(async () => { await a.close(); });

test("AD08: el último técnico no se desactiva ni cambia a Gestor; dos técnicos admiten desactivar uno; concurrencia segura", async () => {
  {
    const idA = await a.createAccount("a@prueba.gov.co", TECNICO);
    const sa = await a.login("a@prueba.gov.co");
    const lista = await sa.api("GET", "/accounts");
    const rev = lista.json.items[0].revision;
    const r1 = await sa.api("PATCH", `/accounts/${idA}`, { expectedRevision: rev, active: false });
    assert.equal(r1.status, 409);
    assert.equal(r1.json.error.codigo, "ULTIMO_TECNICO");
    assert.match(r1.json.error.mensaje, /administrador técnico/);
    assert.equal((await sa.api("PATCH", `/accounts/${idA}`, { expectedRevision: rev, perfil: GESTOR })).status, 409);

    // Dos técnicos: cada uno intenta desactivar al otro a la vez; solo uno puede lograrlo.
    const idB = await a.createAccount("b@prueba.gov.co", TECNICO);
    const sb = await a.login("b@prueba.gov.co");
    const lst = (await sa.api("GET", "/accounts")).json.items as Array<{ id: string; revision: string }>;
    const revOf = (id: string) => lst.find(x => x.id === id)!.revision;
    const [x, y] = await Promise.all([
      sa.api("PATCH", `/accounts/${idB}`, { expectedRevision: revOf(idB), active: false }),
      sb.api("PATCH", `/accounts/${idA}`, { expectedRevision: revOf(idA), active: false }),
    ]);
    // El que gana cierra la sesión del otro: este recibe 409 (último técnico) o 401 (sesión ya revocada).
    assert.equal([x.status, y.status].filter(s => s === 200).length, 1);
    assert.ok([x.status, y.status].every(s => [200, 401, 409].includes(s)));
    const act = await a.db.migrator.query("SELECT count(*)::int n FROM admin.account WHERE active AND profile = $1", [TECNICO]);
    assert.equal(act.rows[0].n, 1);
  }
});


test("AD08: dos desactivaciones simultáneas en la base nunca dejan cero técnicos activos", async () => {
  await a.db.migrator.query("DELETE FROM admin.session");
  await a.db.migrator.query("UPDATE admin.account SET active = true WHERE profile = $1", [TECNICO]);
  const ids = (await a.db.migrator.query("SELECT id FROM admin.account WHERE profile = $1 AND active", [TECNICO])).rows.map(r => r.id as string);
  // Deja exactamente dos técnicos activos.
  for (const extra of ids.slice(2)) await a.db.migrator.query("UPDATE admin.account SET profile = $2 WHERE id = $1", [extra, GESTOR]);
  const [p, q] = ids;
  const run = async (id: string) => {
    const c = await a.db.admin.connect();
    try {
      await c.query("BEGIN");
      await c.query("UPDATE admin.account SET active = false WHERE id = $1", [id]);
      await new Promise(r => setTimeout(r, 100));
      await c.query("COMMIT");
      return "ok";
    } catch { await c.query("ROLLBACK").catch(() => {}); return "rechazada"; } finally { c.release(); }
  };
  const res = await Promise.all([run(p), run(q)]);
  assert.deepEqual(res.slice().sort(), ["ok", "rechazada"]);
  const n = (await a.db.migrator.query("SELECT count(*)::int n FROM admin.account WHERE active AND profile = $1", [TECNICO])).rows[0].n;
  assert.equal(n, 1);
});
