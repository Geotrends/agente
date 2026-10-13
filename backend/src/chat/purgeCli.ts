/** Tarea horaria de purga (`node dist/chat/purgeCli.js`). Rol `chat_maint`; no imprime contenido. */
import pg from "pg";
import { purgeChat } from "./retention.js";

const url = process.env.MAINT_DATABASE_URL;
if (!url) { console.error("Falta MAINT_DATABASE_URL."); process.exit(1); }
const pool = new pg.Pool({ connectionString: url, max: 2 });
try {
  const r = await purgeChat(pool);
  console.log(`[purga] corrida ${r.runId}: ${r.rowsPurged} consultas depuradas, ${r.conversationsDeleted} conversaciones eliminadas.`);
} catch (error) {
  console.error("[purga] falló:", (error as { code?: string }).code ?? (error instanceof Error ? error.name : "error"));
  process.exitCode = 1;
} finally {
  await pool.end();
}
