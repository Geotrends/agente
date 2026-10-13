import test from "node:test";
import assert from "node:assert/strict";
import { createChatAdminDb, type ChatAdminDb } from "./chatAdminDb.js";
import { saveAnonymousUsage, saveInteraction, EpisodeTracker, writeEpisodes, type AuthorizedRecord } from "../../src/chat/records.js";
import { computeCost, currentTariff, missingTariffs } from "../../src/chat/tariffs.js";
import { createConversation } from "../../src/chat/conversations.js";
import { purgeChat } from "../../src/chat/retention.js";

const M20 = "openai.gpt-oss-20b-1:0";
const M120 = "openai.gpt-oss-120b-1:0";

async function tarifas(db: ChatAdminDb): Promise<void> {
  await db.admin.query(
    `INSERT INTO chat.tariff (model_id, region, currency, input_price_per_million, output_price_per_million, valid_from, source_url) VALUES
     ($1,'us-east-1','USD',0.07,0.30,'2026-01-01','https://aws.amazon.com/bedrock/pricing/'),
     ($2,'us-east-1','USD',0.15,0.60,'2026-01-01','https://aws.amazon.com/bedrock/pricing/')`, [M20, M120]);
}

const rec = (conversationId: string, over: Partial<AuthorizedRecord> = {}): AuthorizedRecord => ({
  conversationId, receivedAt: new Date("2026-10-08T12:00:00Z"), categoria: "Ecosistemas", pregunta: "¿Pregunta?", respuesta: "Respuesta",
  tipo: "respondida", fuentes: [{ id: "doc-1", nombre: "Doc", enlace: "https://x.co/d", fecha: "2026-03-15" }],
  durationMs: 1234.6, visibleTokens: 321, usage: { modelId: M20, inputTokens: 1000, outputTokens: 500 }, ...over,
});

test("el costo es decimal y recalculable a mano", () => {
  assert.equal(computeCost(1000, 500, { inputPerMillion: "0.07", outputPerMillion: "0.30" }), "0.000220000000");
  assert.equal(computeCost(123456, 7890, { inputPerMillion: "0.15", outputPerMillion: "0.60" }), "0.023252400000");
  assert.equal(computeCost(0, 0, { inputPerMillion: "0.15", outputPerMillion: "0.60" }), "0.000000000000");
});

test("10 registros (5 por modelo, uno de respaldo): una fila cada uno, costo igual al recálculo y responseId tras commit", async () => {
  const db = await createChatAdminDb();
  try {
    await tarifas(db);
    const conv = await createConversation("sub-1", "2026-10", db.chat);
    const tarifaVista = (await currentTariff(M120, new Date("2026-10-08"), db.chat))!;
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const modelId = i < 5 ? M20 : M120;
      const id = await saveInteraction(rec(conv, { usage: { modelId, inputTokens: 1000 + i, outputTokens: 400 + i } }), {}, db.chat);
      assert.ok(id, "responseId solo si la fila se confirmó");
      ids.push(id!);
    }
    assert.equal(new Set(ids).size, 10);
    const { rows } = await db.migrator.query("SELECT model, input_tokens, output_tokens, estimated_cost::text c, tariff_version, response_id FROM chat.interaction ORDER BY row_id");
    assert.equal(rows.length, 10);
    assert.equal(rows.filter(r => r.model === "gpt-oss-20b").length, 5);
    assert.equal(rows.filter(r => r.model === "gpt-oss-120b").length, 5);
    for (const r of rows) {
      const t = r.model === "gpt-oss-20b" ? { inputPerMillion: "0.07", outputPerMillion: "0.30" } : { inputPerMillion: "0.15", outputPerMillion: "0.60" };
      assert.equal(r.c, computeCost(r.input_tokens, r.output_tokens, t));
      assert.ok(r.tariff_version);
    }
    assert.equal(tarifaVista.version > 0, true);
    assert.deepEqual(await missingTariffs([M20, M120], new Date("2026-10-08"), db.chat), []);
    assert.deepEqual(await missingTariffs([M20, M120], new Date("2025-01-01"), db.chat), [M20, M120], "antes de la vigencia no hay tarifa");
  } finally { await db.close(); }
});

test("ruta sin LLM cuesta cero demostrable; sin tarifa vigente no se inventa un cero", async () => {
  const db = await createChatAdminDb();
  try {
    const conv = await createConversation("s", "p", db.chat);
    assert.ok(await saveInteraction(rec(conv, { tipo: "sin información", fuentes: [], usage: { modelId: "none", inputTokens: 0, outputTokens: 0 } }), {}, db.chat));
    assert.ok(await saveInteraction(rec(conv), {}, db.chat), "se registra aunque falte la tarifa");
    const { rows } = await db.migrator.query("SELECT model, estimated_cost::text c, tariff_version FROM chat.interaction ORDER BY row_id");
    assert.deepEqual(rows.map(r => [r.model, r.c, r.tariff_version]), [["none", "0.000000000000", null], ["gpt-oss-20b", null, null]]);
    await assert.rejects(db.migrator.query("SET ROLE chat_owner; INSERT INTO chat.interaction (received_at,result_type,duration_ms,visible_output_tokens,model,input_tokens,output_tokens,estimated_cost) VALUES (now(),'respondida',1,1,'gpt-oss-20b',1,1,0)"), /interaction_cost_ck/);
  } finally { await db.close(); }
});

test("tarifas: no se permiten periodos activos solapados por modelo y región", async () => {
  const db = await createChatAdminDb();
  try {
    await tarifas(db);
    await assert.rejects(db.admin.query(
      `INSERT INTO chat.tariff (model_id, region, currency, input_price_per_million, output_price_per_million, valid_from, source_url)
       VALUES ($1,'us-east-1','USD',0.1,0.2,'2026-06-01','https://aws.amazon.com/bedrock/pricing/')`, [M20]), /tariff_no_overlap/);
  } finally { await db.close(); }
});

test("6 anónimos: solo seis campos, sin identificadores ni texto en ninguna tabla", async () => {
  const db = await createChatAdminDb();
  try {
    await tarifas(db);
    for (let i = 0; i < 6; i++) {
      assert.equal(await saveAnonymousUsage({ receivedAt: new Date("2026-10-08T12:00:00Z"), usage: { modelId: i % 2 ? M120 : M20, inputTokens: 100, outputTokens: 50 } }, {}, db.chat), true);
    }
    const cols = await db.migrator.query("SELECT column_name FROM information_schema.columns WHERE table_schema='chat' AND table_name='anonymous_usage' ORDER BY ordinal_position");
    assert.deepEqual(cols.rows.map(r => r.column_name), ["received_at", "mode", "model", "input_tokens", "output_tokens", "estimated_cost"]);
    assert.equal((await db.migrator.query("SELECT count(*)::int n FROM chat.anonymous_usage WHERE mode <> 'anónima'")).rows[0].n, 0);
    for (const t of ["interaction", "conversation"]) assert.equal((await db.migrator.query(`SELECT count(*)::int n FROM chat.${t}`)).rows[0].n, 0, `${t} debe seguir vacía`);
    // Sin clave primaria ni columna que identifique la consulta.
    assert.equal((await db.migrator.query("SELECT count(*)::int n FROM pg_constraint WHERE conrelid = 'chat.anonymous_usage'::regclass AND contype IN ('p','u','f')")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("6 fallos de escritura + 2 recuperadas: respuesta sin responseId, un solo aviso por episodio", async () => {
  const db = await createChatAdminDb();
  try {
    await tarifas(db);
    const conv = await createConversation("s", "p", db.chat);
    Object.assign(writeEpisodes, new EpisodeTracker());
    writeEpisodes.success();
    let avisos = 0;
    const hooks = { onNewFailureEpisode: () => { avisos++; } };
    await db.migrator.query("REVOKE INSERT ON chat.interaction FROM chat_app");
    for (let i = 0; i < 6; i++) assert.equal(await saveInteraction(rec(conv), hooks, db.chat), null);
    assert.equal(avisos, 1, "6 fallos seguidos no son 6 avisos");
    await db.migrator.query("GRANT INSERT ON chat.interaction TO chat_app");
    for (let i = 0; i < 2; i++) assert.ok(await saveInteraction(rec(conv), hooks, db.chat));
    assert.equal(writeEpisodes.inEpisode, false, "el primer éxito restablece");
    await db.migrator.query("REVOKE INSERT ON chat.interaction FROM chat_app");
    assert.equal(await saveInteraction(rec(conv), hooks, db.chat), null);
    assert.equal(avisos, 2, "un episodio nuevo avisa de nuevo");
    assert.equal((await db.migrator.query("SELECT count(*)::int n FROM chat.interaction")).rows[0].n, 2);
  } finally { await db.close(); }
});

test("retención: 11 meses 29 días conserva, 12 meses 1 día depura, dos corridas idempotentes, estadísticas intactas", async () => {
  const db = await createChatAdminDb();
  try {
    await tarifas(db);
    await db.migrator.query("UPDATE chat.tariff SET valid_from = '2024-01-01'");
    const conv = await createConversation("s", "p", db.chat, new Date("2025-01-01T00:00:00Z"));
    const ahora = new Date("2026-10-08T12:00:00Z");
    const hace = (meses: number, dias: number) => { const d = new Date(ahora); d.setUTCMonth(d.getUTCMonth() - meses); d.setUTCDate(d.getUTCDate() - dias); return d; };
    const joven = await saveInteraction(rec(conv, { receivedAt: hace(11, 29) }), {}, db.chat);
    const vieja = await saveInteraction(rec(conv, { receivedAt: hace(12, 1) }), {}, db.chat);
    assert.ok(joven && vieja);

    const r1 = await purgeChat(db.maint, ahora);
    assert.equal(r1.rowsPurged, 1);
    const r2 = await purgeChat(db.maint, ahora);
    assert.equal(r2.rowsPurged, 0, "idempotente");
    const { rows } = await db.migrator.query("SELECT response_id, question_text, answer_text, conversation_id, cited_documents, purged_at, model, input_tokens, estimated_cost::text c, result_type, category FROM chat.interaction ORDER BY row_id");
    assert.equal(rows[0].question_text, "¿Pregunta?", "11 m 29 d se conserva");
    assert.equal(rows[1].question_text, null);
    assert.equal(rows[1].answer_text, null);
    assert.equal(rows[1].response_id, null);
    assert.equal(rows[1].conversation_id, null);
    // SPEC005 (RNF-C3-IN-01, H005-03): las fuentes citadas son del catálogo y se conservan; antes
    // esta expectativa exigía lista vacía y contradecía «conservando los demás campos».
    assert.deepEqual(rows[1].cited_documents, [{ id: "doc-1", nombre: "Doc", enlace: "https://x.co/d", fecha: "2026-03-15" }]);
    assert.ok(rows[1].purged_at);
    assert.equal(rows[1].model, "gpt-oss-20b"); assert.equal(rows[1].input_tokens, 1000); assert.ok(rows[1].c); assert.equal(rows[1].result_type, "respondida");
    const runs = await db.migrator.query("SELECT status, rows_purged FROM chat.purge_run ORDER BY run_id");
    assert.deepEqual(runs.rows, [{ status: "ok", rows_purged: 1 }, { status: "ok", rows_purged: 0 }]);
    // La conversación sigue (aún tiene una fila vigente); al depurarse la última, desaparece.
    assert.equal((await db.migrator.query("SELECT count(*)::int n FROM chat.conversation")).rows[0].n, 1);
    const despues = new Date(ahora.getTime() + 400 * 86_400_000);
    await purgeChat(db.maint, despues);
    assert.equal((await db.migrator.query("SELECT count(*)::int n FROM chat.conversation")).rows[0].n, 0);
  } finally { await db.close(); }
});

// ── SPEC005 · N301 (T033) ──────────────────────────────────────────────────────────────────────

test("N301 · 11 m 29 d se conserva, 12 m 1 d se depura: solo texto e IDs cambian; el resto y las valoraciones quedan exactos", async () => {
  const db = await createChatAdminDb();
  try {
    await tarifas(db);
    await db.migrator.query("UPDATE chat.tariff SET valid_from = '2024-01-01'");
    const conv = await createConversation("sub-n301", "p", db.chat, new Date("2025-01-01T00:00:00Z"));
    const ahora = new Date("2026-10-08T12:00:00Z");
    const hace = (meses: number, dias: number) => { const d = new Date(ahora); d.setUTCMonth(d.getUTCMonth() - meses); d.setUTCDate(d.getUTCDate() - dias); return d; };
    const fuentes = [
      { id: "doc-1", nombre: "Documento uno", enlace: "https://x.co/uno.pdf", fecha: "2026-03-15" },
      { id: "doc-2", nombre: "Documento dos", enlace: "https://x.co/dos.pdf", fecha: "2026-01-02" },
    ];
    const ids = [
      await saveInteraction(rec(conv, { receivedAt: hace(11, 29), fuentes, durationMs: 4321, visibleTokens: 777 }), {}, db.chat),
      await saveInteraction(rec(conv, { receivedAt: hace(12, 1), fuentes, durationMs: 9876, visibleTokens: 654, categoria: "Bienestar Animal", tipo: "respondida" }), {}, db.chat),
    ];
    assert.ok(ids[0] && ids[1]);
    // Valoraciones sobre ambas, por la función real (propiedad por credencial técnica).
    const { bindingHash } = await import("../../src/chat/conversations.js");
    await db.chat.query("SELECT chat.register_rating($1::uuid, $2, 'Útil', NULL)", [ids[0], bindingHash("sub-n301")]);
    await db.chat.query("SELECT chat.register_rating($1::uuid, $2, 'No útil', 'Otro')", [ids[1], bindingHash("sub-n301")]);

    const CONSERVADOS = "row_id, received_at, category, result_type, cited_documents, duration_ms, visible_output_tokens, model, input_tokens, output_tokens, tariff_version, estimated_cost::text AS estimated_cost";
    const antes = (await db.migrator.query(`SELECT ${CONSERVADOS} FROM chat.interaction ORDER BY row_id`)).rows;
    const valoracionesAntes = (await db.migrator.query("SELECT interaction_row_id, valoracion, motivo, created_at FROM chat.valoracion ORDER BY 1")).rows;

    // Dos ejecuciones de la purga (una por hora): la segunda no cambia nada.
    const r1 = await purgeChat(db.maint, ahora);
    const r2 = await purgeChat(db.maint, new Date(ahora.getTime() + 3_600_000));
    assert.equal(r1.rowsPurged, 1);
    assert.equal(r2.rowsPurged, 0);

    const despues = (await db.migrator.query(`SELECT ${CONSERVADOS} FROM chat.interaction ORDER BY row_id`)).rows;
    assert.deepEqual(despues, antes, "los campos conservados son idénticos, incluidos las fuentes citadas");
    const textos = (await db.migrator.query("SELECT question_text, answer_text, conversation_id, response_id, purged_at FROM chat.interaction ORDER BY row_id")).rows;
    assert.equal(textos[0].question_text, "¿Pregunta?"); assert.ok(textos[0].response_id); assert.equal(textos[0].purged_at, null);
    for (const campo of ["question_text", "answer_text", "conversation_id", "response_id"]) assert.equal(textos[1][campo], null, `${campo} depurado`);
    assert.ok(textos[1].purged_at);
    assert.deepEqual((await db.migrator.query("SELECT interaction_row_id, valoracion, motivo, created_at FROM chat.valoracion ORDER BY 1")).rows, valoracionesAntes,
      "las valoraciones conservan su vínculo interno y su contenido");
    // 0 textos y 0 UUID públicos de la fila depurada en toda la base.
    const todo = JSON.stringify((await db.migrator.query("SELECT row_to_json(t) j FROM chat.interaction t WHERE purged_at IS NOT NULL")).rows);
    assert.ok(!todo.includes("Respuesta") && !todo.includes(ids[1]!));
    const runs = (await db.migrator.query("SELECT status FROM chat.purge_run ORDER BY run_id")).rows.map(r => r.status);
    assert.deepEqual(runs, ["ok", "ok"]);
  } finally { await db.close(); }
});
