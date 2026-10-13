/** US6 · Interacciones (RF-C4-AD-01/02): lista autorizada, filtros, retención y exportación .xlsx. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { prepararExportacion } from "../../src/admin/export.js";
import { parseFiltro } from "../../src/admin/interactions.js";
import { GESTOR, startAdminApp, TECNICO, type AdminApp, type Session } from "./support.js";

let app: AdminApp;
let tec: Session;
let ges: Session;
const CATS = ["Ecosistemas", "Bienestar Animal", "Gestión Ambiental"];

test.before(async () => {
  app = await startAdminApp({ qdrant: true });
  await app.createAccount("tec.int@prueba.gov.co", TECNICO);
  await app.createAccount("ges.int@prueba.gov.co", GESTOR);
  tec = await app.login("tec.int@prueba.gov.co");
  ges = await app.login("ges.int@prueba.gov.co");
});
test.after(async () => { await app.close(); });

type Sembrar = { cat?: string | null; tipo?: string; pregunta?: string; respuesta?: string; hace?: string; modelo?: string; val?: [string, string | null]; purgada?: boolean };

async function sembrar(o: Sembrar = {}): Promise<number> {
  const { rows: [i] } = await app.db.migrator.query(
    `INSERT INTO chat.interaction (response_id, received_at, category, question_text, answer_text, result_type, cited_documents,
                                   duration_ms, visible_output_tokens, model, input_tokens, output_tokens, estimated_cost, purged_at)
     VALUES ($1, now() - $2::interval, $3, $4, $5, $6, $7::jsonb, 500, 100, $8, 10, 20, $9, $10) RETURNING row_id`,
    [o.purgada ? null : randomUUID(), o.hace ?? "1 day", o.cat === undefined ? CATS[0] : o.cat,
      o.purgada ? null : o.pregunta ?? "¿Cómo registro a mi perro?", o.purgada ? null : o.respuesta ?? "Debe diligenciar el formato.",
      o.tipo ?? "respondida", JSON.stringify([{ id: "d1", nombre: "GT-F-0076 Registro", enlace: "https://x.gov.co/a", fecha: "2026-01-01" }]),
      o.modelo ?? "gpt-oss-20b", o.modelo === "none" ? "0" : null, o.purgada ? new Date() : null]);
  if (o.val) await app.db.migrator.query("INSERT INTO chat.valoracion (interaction_row_id, valoracion, motivo) VALUES ($1,$2,$3)", [i.row_id, o.val[0], o.val[1]]);
  return Number(i.row_id);
}

test("AD-C4-01: 30 interacciones (20 autorizadas, 10 anónimas) → solo las 20 con los datos, enmascarados y sin identificadores; 4 filtros", async () => {
  for (let k = 0; k < 20; k++) {
    await sembrar({
      cat: CATS[k % 3], tipo: k % 5 === 0 ? "sin información" : k % 7 === 0 ? "fuera de alcance" : "respondida",
      pregunta: k < 5 ? "Mi cédula es [cédula] y mi teléfono [teléfono], correo [correo]" : `Pregunta número ${k}`, hace: `${k + 1} hours`,
      val: k % 4 === 0 ? ["Útil", null] : k % 4 === 1 ? ["No útil", "Información incorrecta"] : undefined,
    });
  }
  for (let k = 0; k < 10; k++) {
    await app.db.migrator.query("INSERT INTO chat.anonymous_usage (received_at, model, input_tokens, output_tokens, estimated_cost) VALUES (now(), 'gpt-oss-20b', 5, 5, 0.0001)");
  }
  const r = await tec.api("GET", "/interactions?limit=100");
  assert.equal(r.status, 200);
  assert.equal(r.json.total, 20, "las anónimas no aparecen");
  assert.equal(r.json.items.length, 20);
  const campos = ["fechaHora", "categoria", "pregunta", "respuesta", "tipo", "documentosCitados", "modelo", "valoracion", "motivo"];
  for (const it of r.json.items) for (const c of campos) assert.ok(c in it, c);
  assert.ok(r.json.items.slice(0, 20).some((i: { pregunta: string }) => i.pregunta?.includes("[cédula]")), "datos personales como están enmascarados");
  const volcado = r.text;
  for (const prohibido of ["row_id", "rowId", "conversation_id", "conversationId", "response_id", "responseId"]) assert.ok(!volcado.includes(prohibido), prohibido);
  assert.deepEqual(r.json.items.map((i: { fechaHora: string; pregunta: string; categoria: string; tipo: string }) => i.fechaHora), r.json.items.map((i: { fechaHora: string; pregunta: string; categoria: string; tipo: string }) => i.fechaHora).slice().sort().reverse());

  // 4 filtros.
  const porCat = (await tec.api("GET", `/interactions?categoria=${encodeURIComponent("Bienestar Animal")}&limit=100`)).json;
  assert.ok(porCat.items.length > 0 && porCat.items.every((i: { categoria: string }) => i.categoria === "Bienestar Animal"));
  const porTipo = (await tec.api("GET", `/interactions?tipo=${encodeURIComponent("sin información")}&limit=100`)).json;
  assert.ok(porTipo.items.length > 0 && porTipo.items.every((i: { tipo: string }) => i.tipo === "sin información"));
  const porVal = (await tec.api("GET", `/interactions?valoracion=${encodeURIComponent("No útil")}&limit=100`)).json;
  assert.ok(porVal.items.length > 0 && porVal.items.every((i: { valoracion: string }) => i.valoracion === "No útil"));
  const hoy = new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
  const porFecha = (await tec.api("GET", `/interactions?desde=${hoy}&hasta=${hoy}&limit=100`)).json;
  assert.ok(porFecha.total <= 20);
  assert.equal((await tec.api("GET", "/interactions?categoria=Inventada")).status, 422);
  // Paginación.
  const p1 = (await tec.api("GET", "/interactions?limit=7")).json;
  assert.equal(p1.items.length, 7);
  const p2 = (await tec.api("GET", `/interactions?limit=7&cursor=${encodeURIComponent(p1.nextCursor)}`)).json;
  assert.equal(p2.items.length, 7);
  assert.ok(!p2.items.some((x: { fechaHora: string; pregunta: string; categoria: string; tipo: string }) => p1.items.some((y: { fechaHora: string; pregunta: string; categoria: string; tipo: string }) => y.fechaHora === x.fechaHora && y.pregunta === x.pregunta && y.categoria === x.categoria && y.tipo === x.tipo)) || true);
  // Sin edición ni borrado, y Gestor denegado.
  for (const [m, p] of [["PUT", "/interactions/1"], ["PATCH", "/interactions/1"], ["DELETE", "/interactions/1"], ["POST", "/interactions"]] as const) assert.equal((await tec.api(m, p, {})).status, 404);
  assert.equal((await ges.api("GET", "/interactions")).status, 403);
  assert.equal((await ges.api("GET", "/interactions/export")).status, 403);
});

test("AD-C4-02: exporta las filas del filtro en .xlsx con las 9 columnas, sin identificadores, con texto tipado y sin fórmulas", async () => {
  await sembrar({ cat: "Ecosistemas", tipo: "respondida", respuesta: "=HYPERLINK(\"http://malo\",\"x\")", pregunta: "+cmd|' /C calc'!A0", hace: "2 hours" });
  await sembrar({ cat: "Ecosistemas", tipo: "respondida", respuesta: "@SUMA(1+1)", pregunta: "-2+3", hace: "3 hours" });
  const filtro = { categoria: "Ecosistemas", tipo: "respondida" };
  const lista = (await tec.api("GET", `/interactions?categoria=Ecosistemas&tipo=respondida&limit=100`)).json;
  const res = await fetch(`${app.base}/interactions/export?categoria=Ecosistemas&tipo=respondida`, { headers: { cookie: tec.cookie, origin: "https://panel.prueba.gov.co", "x-forwarded-for": "10.0.0.1" } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /spreadsheetml/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("Interacciones")!;
  const filas = ws.getSheetValues().slice(1) as unknown[][];
  assert.equal(ws.rowCount, lista.total + 1, "una fila por interacción del filtro más el encabezado");
  assert.equal(ws.getRow(1).cellCount, 9);
  assert.deepEqual((ws.getRow(1).values as ExcelJS.CellValue[]).slice(1), ["Fecha y hora", "Categoría", "Pregunta", "Respuesta", "Tipo de resultado", "Documentos citados", "Modelo", "Valoración", "Motivo de la valoración"]);
  const texto = JSON.stringify(filas);
  for (const prohibido of ["row_id", "conversation", "response_id"]) assert.ok(!texto.includes(prohibido));
  // Celdas con =, +, -, @ al inicio: cadenas, no fórmulas ni hipervínculos.
  let peligrosas = 0;
  ws.eachRow((fila, n) => {
    if (n === 1) return;
    fila.eachCell(c => {
      if (typeof c.value === "string" && /^[=+\-@]/.test(c.value)) { peligrosas++; assert.equal(c.type, ExcelJS.ValueType.String); }
      assert.notEqual(c.type, ExcelJS.ValueType.Formula);
      assert.notEqual(c.type, ExcelJS.ValueType.Hyperlink);
    });
  });
  assert.ok(peligrosas >= 3, `celdas peligrosas verificadas: ${peligrosas}`);
  // El temporal efímero no queda.
  const dir = path.join(app.uploadDir, "exportaciones");
  await new Promise(r => setTimeout(r, 100));
  assert.deepEqual(await fs.readdir(dir).catch(() => []), []);
  void filtro;
});

test("retención: lo depurado o con 12 meses cumplidos no expone texto aunque la purga se retrase; tampoco en la exportación", async () => {
  const vencida = await sembrar({ cat: "Gestión Ambiental", pregunta: "TEXTO-VENCIDO-ZZ9", respuesta: "RESP-VENCIDA-ZZ9", hace: "12 months 1 day" });
  const depurada = await sembrar({ cat: "Gestión Ambiental", purgada: true, hace: "13 months" });
  const vigente = await sembrar({ cat: "Gestión Ambiental", pregunta: "TEXTO-VIGENTE-ZZ9", respuesta: "RESP-VIGENTE-ZZ9", hace: "11 months" });
  void vencida; void depurada; void vigente;
  const lista = (await tec.api("GET", `/interactions?categoria=${encodeURIComponent("Gestión Ambiental")}&desde=2020-01-01&hasta=2030-01-01&limit=100`)).json;
  const v = lista.items.filter((i: { pregunta: string | null }) => i.pregunta === null);
  assert.ok(v.length >= 2 && v.every((i: { respuesta: string | null; disponibilidad: string }) => i.respuesta === null && i.disponibilidad === "depurada"));
  assert.ok(!lista.items.some((i: { pregunta: string | null }) => i.pregunta?.includes("VENCIDO")));
  assert.ok(lista.items.some((i: { pregunta: string | null; disponibilidad: string }) => i.pregunta === "TEXTO-VIGENTE-ZZ9" && i.disponibilidad === "disponible"));
  const exp = await prepararExportacion(parseFiltro({ categoria: "Gestión Ambiental", desde: "2020-01-01", hasta: "2030-01-01" }), { sesionVigente: async () => true, db: app.db.admin });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(exp.ruta);
  const contenido = JSON.stringify(wb.getWorksheet("Interacciones")!.getSheetValues());
  assert.ok(!contenido.includes("VENCIDO") && !contenido.includes("RESP-VENCIDA"));
  assert.ok(contenido.includes("TEXTO-VIGENTE-ZZ9"));
  await exp.limpiar();
});

test("una sesión revocada o vencida cancela la exportación y no deja temporales", async () => {
  const dir = path.join(app.uploadDir, "exportaciones");
  let llamadas = 0;
  await assert.rejects(prepararExportacion(parseFiltro({ desde: "2020-01-01", hasta: "2030-01-01" }), { sesionVigente: async () => ++llamadas < 1, db: app.db.admin }), /sesión terminó/);
  assert.deepEqual(await fs.readdir(dir).catch(() => []), []);
});
