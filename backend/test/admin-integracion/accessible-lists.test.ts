import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { crearPdf, RELLENO } from "./fixtures.js";
import { GESTOR, startAdminApp, TECNICO, type AdminApp, type Session } from "./support.js";
let app: AdminApp, technical: Session, manager: Session, other: Session, uploads: string;
test.before(async () => {
  uploads = await fs.mkdtemp(path.join(os.tmpdir(), "admin-ux-uploads-"));
  process.env.KB_UPLOAD_DIR = uploads;
  app = await startAdminApp();
  await app.createAccount("ux.technical@prueba.gov.co", TECNICO);
  await app.createAccount("ux.manager@prueba.gov.co", GESTOR);
  await app.createAccount("ux.other@prueba.gov.co", GESTOR);
  technical = await app.login("ux.technical@prueba.gov.co");
  manager = await app.login("ux.manager@prueba.gov.co");
  other = await app.login("ux.other@prueba.gov.co");
  await app.db.migrator.query(`INSERT INTO kb.kb_elemento (clave,nombre,tipo,direccion,url_origen,estado,formato_original,fuente,origen,procedimientos_origen)
    SELECT 'https://ambientometroenvigado.com/ux-' || g, 'Guía forestal ' || lpad(g::text,3,'0'), 'pagina','ecosistemas',
      'https://ambientometroenvigado.com/ux-' || g,'pendiente_aprobacion','html','ambientometro','scraper',ARRAY['Ambientómetro']::text[] FROM generate_series(1,35) g`);
});
test.after(async () => { await app?.close(); if (uploads) await fs.rm(uploads, { recursive: true, force: true }); });
test("búsqueda sin tildes, orden y páginas del servidor mantienen totales y exportación por cursor", async () => {
  const first = await technical.api("GET", "/documents?search=guia%20forestal&limit=15&page=1&order=name");
  assert.equal(first.status, 200, first.text); assert.equal(first.json.total, 35); assert.equal(first.json.items.length, 15);
  assert.equal(first.json.items[0].nombre, "Guía forestal 001");
  const next = await technical.api("GET", "/documents?search=guia%20forestal&limit=15&page=2&order=name");
  assert.equal(next.json.items[0].nombre, "Guía forestal 016");
  const a = new Set(first.json.items.map((d: { id: string }) => d.id));
  assert.ok(next.json.items.every((d: { id: string }) => !a.has(d.id)));
  const empty = await technical.api("GET", "/documents?search=no-existe&page=1"); assert.equal(empty.json.total, 0);
  let cursor: string | null = null; const ids: string[] = [];
  do {
    const result = await technical.api("GET", `/documents?search=guia&limit=15${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    assert.equal(result.status, 200, result.text); ids.push(...result.json.items.map((d: { id: string }) => d.id)); cursor = result.json.nextCursor;
  } while (cursor);
  assert.equal(new Set(ids).size, 35);
  const selected = await technical.api("GET", `/documents?id=${ids[0]}`); assert.equal(selected.json.total, 1);
  for (const query of ["page=-1", "page=100001", "order=nombre;DROP", "id=incorrecto"]) assert.equal((await technical.api("GET", `/documents?${query}`)).status, 422);
});
test("búsqueda de cuentas alcanza usuarios posteriores a la página 100", async () => {
  await app.db.migrator.query(`INSERT INTO admin.account(email,display_name,profile,password_phc,must_change_password)
    SELECT 'ux-' || g || '@prueba.gov.co','Usuario UX ' || g,'Gestor documental',(SELECT password_phc FROM admin.account LIMIT 1),false FROM generate_series(1,105) g`);
  const r = await technical.api("GET", "/accounts?limit=25&search=ux-105%40");
  assert.equal(r.status, 200, r.text); assert.equal(r.json.total, 1); assert.equal(r.json.items[0].email, "ux-105@prueba.gov.co");
  const ids = new Set<string>(); let cursor: string | null = null;
  do {
    const result = await technical.api("GET", `/accounts?search=Usuario%20UX&limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    assert.equal(result.status, 200, result.text);
    for (const item of result.json.items) { assert.ok(!ids.has(item.id)); ids.add(item.id); }
    cursor = result.json.nextCursor;
  } while (cursor);
  assert.equal(ids.size, 105);
});
test("el enlace directo a una propuesta respeta la propiedad del Gestor", async () => {
  const created = await manager.api("POST", "/link-proposals", { type: "add", url: "https://ambientometroenvigado.com/ux-propuesta", direction: "Ecosistemas", justification: "Cobertura de enlace directo accesible" });
  assert.equal(created.status, 201, created.text);
  const id = created.json.id;
  for (const user of [technical, manager]) { const r = await user.api("GET", `/link-proposals?id=${id}`); assert.equal(r.json.total, 1); }
  assert.equal((await other.api("GET", `/link-proposals?id=${id}`)).json.total, 0);
});
test("vaciar fechas y versión elimina valores sin alterar los demás campos", async () => {
  const upload = await manager.upload({ type: "Documento", title: "Documento editable UX", direction: "Ecosistemas", publicUrl: "https://ambientometroenvigado.com/ux-editable", associatedProcedure: "ninguno", version: "2", updatedDate: "2026-10-19", validUntil: "2027-10-19" }, { bytes: crearPdf([RELLENO]), name: "ux.pdf" });
  assert.equal(upload.status, 201, upload.text);
  const d = (await technical.api("GET", `/documents?id=${upload.json.id}`)).json.items[0];
  const r = await technical.api("PATCH", `/documents/${d.id}/metadata`, { expectedRevision: d.revision, changes: { version: "", updatedDate: "", validUntil: "" } });
  assert.equal(r.status, 200, r.text);
  const updated = (await technical.api("GET", `/documents?id=${d.id}`)).json.items[0];
  assert.equal(updated.version, "N/A"); assert.equal(updated.fechaActualizacion, "N/A"); assert.equal(updated.validoHasta, "N/A"); assert.equal(updated.nombre, d.nombre);
});

test("los cursores de pendientes y auditoría conservan precisión y no repiten registros", async () => {
  await app.db.migrator.query(`INSERT INTO admin.audit (actor_account_id,action,object_type,object_id,result)
    SELECT $1, 'ux.prueba', 'documento', g::text, 'ok' FROM generate_series(1,35) g`, [technical.accountId]);
  for (const endpoint of ["/pending?limit=15", "/audit?accion=ux.prueba&limit=15"]) {
    const ids = new Set<string>(); let cursor: string | null = null, total = 0;
    do {
      const result = await technical.api("GET", `${endpoint}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      assert.equal(result.status, 200, result.text); total = result.json.total;
      for (const item of result.json.items) { assert.ok(!ids.has(item.id)); ids.add(item.id); }
      cursor = result.json.nextCursor;
    } while (cursor);
    assert.equal(ids.size, total);
  }
});
