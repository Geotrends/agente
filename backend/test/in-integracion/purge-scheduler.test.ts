/**
 * T038 — Programador de la purga (RNF-C3-IN-01).
 *
 * Toma el comando REAL del servicio `chat-purge` de docker-compose.yml (bucle `while true; …; sleep`),
 * reduce solo el intervalo y el ejecutable (tsx en lugar de `dist`), y lo deja correr: las filas de
 * `chat.purge_run` deben venir del programador, no de llamadas manuales. Es evidencia CONTROLADA del
 * bucle; las dos ejecuciones horarias reales del contenedor desplegado siguen pendientes (T076).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createChatAdminDb, ADMIN_URL, PASS } from "../di-integracion/chatAdminDb.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function composeLoop(): string {
  const yml = readFileSync(fileURLToPath(new URL("../../../docker-compose.yml", import.meta.url)), "utf8");
  const bloque = yml.slice(yml.indexOf("  chat-purge:"));
  const m = /command:\s*\["sh",\s*"-c",\s*"([^"]+)"\]/.exec(bloque);
  assert.ok(m, "el servicio chat-purge define un bucle sh -c");
  return m[1];
}

test("el bucle del servicio chat-purge ejecuta la purga repetidamente y deja una corrida ok por vuelta", async () => {
  const db = await createChatAdminDb();
  try {
    const original = composeLoop();
    assert.match(original, /sleep 3600/, "intervalo horario en el compose");
    assert.match(original, /node dist\/chat\/purgeCli\.js/);
    const comando = original.replace("sleep 3600", "sleep 2").replace("node dist/chat/purgeCli.js", "node --import tsx src/chat/purgeCli.ts");

    const u = new URL(ADMIN_URL);
    u.pathname = `/${db.name}`; u.username = "chat_maint"; u.password = PASS.chatMaint;
    const hijo = spawn("sh", ["-c", comando], {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: { ...process.env, MAINT_DATABASE_URL: u.toString() },
      stdio: "ignore", detached: true,
    });
    await sleep(9_000);
    process.kill(-hijo.pid!, "SIGTERM");

    const { rows } = await db.migrator.query("SELECT run_id, started_at, finished_at, status, rows_purged FROM chat.purge_run ORDER BY run_id");
    assert.ok(rows.length >= 2, `el programador produjo ${rows.length} corridas`);
    for (const r of rows) {
      assert.equal(r.status, "ok");
      assert.ok(r.finished_at && new Date(r.finished_at) >= new Date(r.started_at), "inicio y fin reales");
      assert.equal(r.rows_purged, 0);
    }
    const hueco = new Date(rows[1].started_at).getTime() - new Date(rows[0].started_at).getTime();
    assert.ok(hueco >= 1_800, `las corridas están separadas por el intervalo del bucle (${hueco} ms)`);
  } finally { await db.close(); }
});
