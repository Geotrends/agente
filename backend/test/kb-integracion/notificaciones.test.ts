/**
 * Notificaciones contra PostgreSQL real (T015): agrupación y sanitizado.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { listarNotificaciones, marcarRevisada, notificar, sanitizarDescripcion } from "../../src/kb/notifications.js";
import { crearBaseDePrueba, type BaseDePrueba } from "./helpers.js";

let base: BaseDePrueba;
before(async () => { base = await crearBaseDePrueba(); });
after(async () => { await base?.borrar(); });

test("las repetidas sin revisar se agrupan; revisada la anterior, se abre una nueva", async () => {
  const url = "https://ambientometroenvigado.com/caida/";
  const a = await notificar(base.kb, "verificacion_fallida", url, "inaccesible");
  const b = await notificar(base.kb, "verificacion_fallida", url, "inaccesible");
  assert.equal(a, b);
  let [n] = await listarNotificaciones(base.kb);
  assert.equal(n.repeticiones, 2);

  assert.equal(await marcarRevisada(base.kb, a, "cli:prueba"), true);
  assert.equal(await marcarRevisada(base.kb, a, "cli:prueba"), false, "no se revisa dos veces");
  const c = await notificar(base.kb, "verificacion_fallida", url, "inaccesible");
  assert.notEqual(c, a);
  [n] = await listarNotificaciones(base.kb);
  assert.equal(n.repeticiones, 1);
  assert.equal((await listarNotificaciones(base.kb, { todas: true })).length, 2);
});

test("la descripción no lleva rutas, trazas ni datos personales", () => {
  const limpia = sanitizarDescripcion(
    "Fallo leyendo /app/data/gmas2/x.pdf para cédula 1036123456 de juan@correo.com\n    at Object.<anonymous> (/app/dist/kb/sync.js:10:5)",
  );
  assert.doesNotMatch(limpia, /\/app\//);
  assert.doesNotMatch(limpia, /1036123456|juan@correo\.com/);
  assert.doesNotMatch(limpia, /\bat Object/);
});
