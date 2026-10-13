/**
 * T061 · B09 (RF-C3-IN-09, RF-C4-IN-05): doce envíos —siete válidos y cinco inválidos— contra
 * PostgreSQL real, más ID ajeno/depurado/anónimo, cuerpo con texto libre y sesiones inválidas.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { authorize, authorizedAnswer, countRows, ORIGIN, post, queueAnswers, sessionToken, startUiApp } from "./app.js";
import { MOTIVOS } from "../../src/chat/feedback.js";

const MOTIVOS_APROBADOS = ["Información incorrecta", "Información desactualizada", "No responde mi pregunta", "Difícil de entender", "Otro"];

test("los cinco motivos del código coinciden literalmente con los aprobados", () => {
  assert.deepEqual([...MOTIVOS], MOTIVOS_APROBADOS);
});

test("B09 · doce envíos: 7 válidos cruzables con el registro y 5 inválidos sin filas", async () => {
  const c = await startUiApp();
  try {
    queueAnswers(c, 12);
    const tk = await sessionToken(c);
    const conv = await authorize(c, tk);
    const ids: string[] = [];
    for (let i = 0; i < 9; i++) ids.push(await authorizedAnswer(c, tk, conv, `consulta ${i}`));

    // Siete válidos: «Útil» (2) y «No útil» con cada uno de los cinco motivos.
    const validos: Array<Record<string, unknown>> = [
      { responseId: ids[0], valoracion: "Útil" },
      { responseId: ids[1], valoracion: "Útil" },
      ...MOTIVOS_APROBADOS.map((motivo, i) => ({ responseId: ids[2 + i], valoracion: "No útil", motivo })),
    ];
    for (const v of validos) {
      const r = await post(c, "/ratings", tk, v);
      assert.equal(r.status, 201, JSON.stringify(v));
      assert.match(r.headers.get("cache-control") ?? "", /no-store/);
      assert.deepEqual(await r.json(), { responseId: v.responseId, registrada: true });
    }
    assert.equal(await countRows(c, "valoracion"), 7);
    // Cruce con el registro: cada fila apunta a la interacción de ese responseId.
    const cruce = await c.db.migrator.query(
      `SELECT i.response_id::text AS rid, v.valoracion, v.motivo FROM chat.valoracion v JOIN chat.interaction i ON i.row_id = v.interaction_row_id ORDER BY v.interaction_row_id`);
    assert.deepEqual(cruce.rows.map(r => r.rid), ids.slice(0, 7));
    assert.deepEqual(cruce.rows.map(r => r.motivo), [null, null, ...MOTIVOS_APROBADOS]);

    // Cinco inválidos: sin filas nuevas.
    const invalidos: Array<[string, Record<string, unknown>]> = [
      ["ID inexistente", { responseId: "11111111-1111-4111-8111-111111111111", valoracion: "Útil" }],
      ["duplicado", { responseId: ids[0], valoracion: "No útil", motivo: "Otro" }],
      ["motivo ausente", { responseId: ids[7], valoracion: "No útil" }],
      ["motivo con «Útil»", { responseId: ids[7], valoracion: "Útil", motivo: "Otro" }],
      ["motivo fuera de lista", { responseId: ids[7], valoracion: "No útil", motivo: "No me gustó" }],
    ];
    for (const [nombre, body] of invalidos) {
      const r = await post(c, "/ratings", tk, body);
      assert.equal(r.status, 400, nombre);
      const e = await r.json();
      assert.equal(e.error.codigo, "VALIDACION", nombre);
      assert.equal(e.error.mensaje, "No se pudo registrar la valoración.", "mensaje uniforme");
      assert.match(r.headers.get("cache-control") ?? "", /no-store/);
    }
    assert.equal(await countRows(c, "valoracion"), 7, "los inválidos no escribieron nada");
  } finally { await c.close(); }
});

test("rechazos adicionales: texto libre, null en «Útil», tipos erróneos, ID ajeno/depurado/anónimo y sesión inválida", async () => {
  const c = await startUiApp();
  try {
    queueAnswers(c, 4);
    const tk = await sessionToken(c, "1.1.1.1");
    const otro = await sessionToken(c, "2.2.2.2");
    const conv = await authorize(c, tk);
    const rid = await authorizedAnswer(c, tk, conv);
    const antes = await countRows(c, "valoracion");

    const cuerpos: Array<[string, unknown]> = [
      ["texto libre adicional", { responseId: rid, valoracion: "No útil", motivo: "Otro", comentario: "texto" }],
      ["IP/token en el cuerpo", { responseId: rid, valoracion: "Útil", ip: "1.1.1.1" }],
      ["motivo null con «Útil»", { responseId: rid, valoracion: "Útil", motivo: null }],
      ["valoración en minúsculas", { responseId: rid, valoracion: "útil" }],
      ["responseId no UUID", { responseId: "123", valoracion: "Útil" }],
      ["responseId numérico", { responseId: 5, valoracion: "Útil" }],
      ["array", []],
      ["motivo no texto", { responseId: rid, valoracion: "No útil", motivo: 3 }],
    ];
    for (const [nombre, body] of cuerpos) {
      assert.equal((await post(c, "/ratings", tk, body)).status, 400, nombre);
    }
    // ID válido de otra sesión técnica (propiedad).
    assert.equal((await post(c, "/ratings", otro, { responseId: rid, valoracion: "Útil" })).status, 400);
    assert.equal(await countRows(c, "valoracion"), antes);

    // Sin Bearer / token inválido → 401; origen no permitido → 403.
    const sinToken = await fetch(`${c.base}/ratings`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ responseId: rid, valoracion: "Útil" }) });
    assert.equal(sinToken.status, 401);
    assert.equal((await post(c, "/ratings", "token-invalido", { responseId: rid, valoracion: "Útil" })).status, 401);
    const origenAjeno = await fetch(`${c.base}/ratings`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tk}`, origin: "https://malo.example" }, body: JSON.stringify({ responseId: rid, valoracion: "Útil" }) });
    assert.equal(origenAjeno.status, 403);

    // Respuesta anónima: ni siquiera existe responseId; uno inventado se rechaza.
    const anon = await post(c, "/chat", tk, { pregunta: "¿y eso?" });
    assert.ok(!("responseId" in (await anon.json())));
    assert.equal((await post(c, "/ratings", tk, { responseId: "22222222-2222-4222-8222-222222222222", valoracion: "Útil" })).status, 400);

    // Depurada (más de 12 meses): se rechaza igual que inexistente.
    await c.db.migrator.query(`UPDATE chat.interaction SET question_text = NULL, answer_text = NULL, conversation_id = NULL, response_id = NULL, purged_at = now() WHERE response_id = $1::uuid`, [rid]);
    assert.equal((await post(c, "/ratings", tk, { responseId: rid, valoracion: "Útil" })).status, 400);
    assert.equal(await countRows(c, "valoracion"), antes);
  } finally { await c.close(); }
});

// ── SPEC005 · C309 (T027) ────────────────────────────────────────────────────────────────────

test("C309 · rechazo uniforme: inexistente, ajeno, depurado, anónimo y duplicado son indistinguibles byte a byte", async () => {
  const c = await startUiApp();
  try {
    queueAnswers(c, 3);
    const tk = await sessionToken(c, "1.1.1.1");
    const otro = await sessionToken(c, "2.2.2.2");
    const conv = await authorize(c, tk);
    const propia = await authorizedAnswer(c, tk, conv, "propia");
    const aDepurar = await authorizedAnswer(c, tk, conv, "a depurar");
    const duplicada = await authorizedAnswer(c, tk, conv, "duplicada");
    assert.equal((await post(c, "/ratings", tk, { responseId: duplicada, valoracion: "Útil" })).status, 201);
    await c.db.migrator.query(
      `UPDATE chat.interaction SET question_text = NULL, answer_text = NULL, conversation_id = NULL, response_id = NULL, purged_at = now() WHERE response_id = $1::uuid`, [aDepurar]);

    const casos: Array<[string, string, Record<string, unknown>]> = [
      ["inexistente", tk, { responseId: "33333333-3333-4333-8333-333333333333", valoracion: "Útil" }],
      ["ajeno", otro, { responseId: propia, valoracion: "Útil" }],
      ["depurado", tk, { responseId: aDepurar, valoracion: "Útil" }],
      ["duplicado", tk, { responseId: duplicada, valoracion: "Útil" }],
    ];
    const vistos: string[] = [];
    for (const [nombre, token, body] of casos) {
      const r = await post(c, "/ratings", token, body);
      assert.equal(r.status, 400, nombre);
      const cuerpo = await r.json();
      vistos.push(JSON.stringify({ s: r.status, b: cuerpo, cc: r.headers.get("cache-control") }));
    }
    assert.equal(new Set(vistos).size, 1, "ningún caso se distingue de otro");
  } finally { await c.close(); }
});

test("C309 · cinco envíos simultáneos de la misma respuesta: exactamente una fila y un 201", async () => {
  const c = await startUiApp();
  try {
    queueAnswers(c, 1);
    const tk = await sessionToken(c);
    const conv = await authorize(c, tk);
    const rid = await authorizedAnswer(c, tk, conv);
    const rs = await Promise.all(Array.from({ length: 5 }, () => post(c, "/ratings", tk, { responseId: rid, valoracion: "No útil", motivo: "Otro" })));
    const estados = rs.map(r => r.status).sort();
    assert.deepEqual(estados, [201, 400, 400, 400, 400]);
    assert.equal(await countRows(c, "valoracion"), 1);
  } finally { await c.close(); }
});
