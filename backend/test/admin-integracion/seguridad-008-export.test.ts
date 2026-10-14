/** SPEC008 US6 (NV-12): una exportación cuyo cliente se desconecta no deja el archivo temporal. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { prepararExportacion } from "../../src/admin/export.js";
import { raizCargas } from "../../src/kb/documentFiles.js";
import { parseFiltro } from "../../src/admin/interactions.js";
import { startAdminApp, type AdminApp } from "./support.js";

let app: AdminApp;
test.before(async () => { app = await startAdminApp({ qdrant: true }); });
test.after(async () => { await app.close(); });

const huerfanos = async () =>
  (await fs.readdir(path.join(raizCargas(), "exportaciones")).catch(() => [] as string[])).filter(n => n.endsWith(".xlsx"));

test("NV-12: con el cliente desconectado la preparación se cancela y el temporal se elimina", async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    prepararExportacion(parseFiltro({}), { sesionVigente: async () => true, db: app.db.admin, signal: ac.signal }),
    /client_disconnected/);
  assert.deepEqual(await huerfanos(), []);
});

test("NV-12: sin desconexión la exportación se prepara y limpiar() elimina el archivo", async () => {
  const e = await prepararExportacion(parseFiltro({}), { sesionVigente: async () => true, db: app.db.admin });
  assert.equal((await huerfanos()).length, 1);
  await e.limpiar();
  assert.deepEqual(await huerfanos(), []);
});
