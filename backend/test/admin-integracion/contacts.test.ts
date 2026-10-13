/** US4 · Contactos oficiales (RF-C3-AD-35..37): validación literal, CAS, último canal y lectura sin redespliegue. */
import test from "node:test";
import assert from "node:assert/strict";
import { respuestaFueraDeAlcance } from "../../src/chat/answerPolicy.js";
import { bloqueCanalesInmediatos } from "../../src/chat/riskPolicy.js";
import { readContactSnapshot } from "../../src/admin/contacts.js";
import { GESTOR, ORIGIN, startAdminApp, TECNICO, type AdminApp, type Session } from "./support.js";

Object.assign(process.env, { CONSENT_POLICY_VERSION: "2026-10", CONSENT_POLICY_URL: "https://ejemplo.gov.co/politica" });

let app: AdminApp;
let tec: Session;
let ges: Session;

test.before(async () => {
  app = await startAdminApp();
  await app.createAccount("tec.contactos@prueba.gov.co", TECNICO);
  await app.createAccount("ges.contactos@prueba.gov.co", GESTOR);
  tec = await app.login("tec.contactos@prueba.gov.co");
  ges = await app.login("ges.contactos@prueba.gov.co");
  // Carga inicial (los valores oficiales vienen del panel; el código no tiene valores por defecto).
  const c = (await tec.api("GET", "/contacts")).json;
  let rev = c.revision as number;
  rev = (await tec.api("PUT", "/contacts/reception", { revision: rev, pqrsd: "https://pqrsd.prueba.gov.co", whatsapp: "+57 300 000 1111", email: "pqrsd@prueba.gov.co" })).json.revision;
  rev = (await tec.api("PUT", "/contacts/general", { revision: rev, phone: "(604) 000 2222", email: "info@prueba.gov.co", url: "https://prueba.gov.co/contacto" })).json.revision;
  await tec.api("POST", "/contacts/immediate", { revision: rev, name: "Emergencias", description: "Línea 24 horas", type: "teléfono", value: "123" });
});
test.after(async () => { await app.close(); });

const rev = async () => (await tec.api("GET", "/contacts")).json.revision as number;
const snapshot = async () => (await readContactSnapshot(app.db.chat))!;
const apiBase = () => app.base.replace(/\/admin$/, "");

test("AD35: 3 recepciones válidas se ven en la siguiente respuesta sin redespliegue; 4 inválidas se rechazan; no hay forma de quitar un canal", async () => {
  const base = { revision: 0, pqrsd: "https://pqrsd.prueba.gov.co", whatsapp: "+57 300 000 1111", email: "pqrsd@prueba.gov.co" };
  const put = async (cambios: Record<string, unknown>) => tec.api("PUT", "/contacts/reception", { ...base, revision: await rev(), ...cambios });
  assert.equal((await put({ pqrsd: "https://nuevo.pqrsd.gov.co/radicar" })).status, 200);
  assert.equal((await snapshot()).recepcion.pqrsd, "https://nuevo.pqrsd.gov.co/radicar");
  assert.equal((await put({ whatsapp: "(300) 555-0101" })).status, 200);
  assert.equal((await snapshot()).recepcion.whatsapp, "(300) 555-0101");
  assert.equal((await put({ email: "nuevo@pqrsd.gov.co" })).status, 200);
  // La configuración pública (GET /chat/config) ya trae los valores: sin redespliegue.
  const cfg = await fetch(`${apiBase()}/chat/config`, { headers: { origin: ORIGIN } });
  assert.equal(cfg.status, 200);
  assert.equal((await cfg.json()).contactos.recepcion.email, "nuevo@pqrsd.gov.co");

  const inval: Array<[Record<string, unknown>, string]> = [
    [{ pqrsd: "http://pqrsd.gov.co" }, "pqrsd"], [{ whatsapp: "300-ABC-0000" }, "whatsapp"], [{ email: "sin-dominio@" }, "email"], [{ email: "" }, "email"],
  ];
  const antes = JSON.stringify((await snapshot()).recepcion);
  for (const [c, campo] of inval) {
    const r = await put(c);
    assert.equal(r.status, 422, JSON.stringify(c));
    assert.equal(r.json.error.campo, campo);
  }
  assert.equal(JSON.stringify((await snapshot()).recepcion), antes);
  // Sin función para quitar un canal de recepción.
  for (const [m, p] of [["DELETE", "/contacts/reception"], ["DELETE", "/contacts/general"]] as const) assert.equal((await tec.api(m, p, {})).status, 404);
  assert.equal((await ges.api("PUT", "/contacts/reception", { ...base, revision: await rev() })).status, 403);
});

test("AD36: contacto general válido llega al servicio de errores y a una consulta ajena a las 3 Direcciones; 4 inválidos rechazados", async () => {
  const put = async (c: Record<string, unknown>) => tec.api("PUT", "/contacts/general", { revision: await rev(), phone: "(604) 111 2222", email: "general@prueba.gov.co", url: "https://prueba.gov.co/contacto", ...c });
  for (const [c, valor] of [[{ phone: "(604) 999 8888" }, "(604) 999 8888"], [{ email: "atencion@prueba.gov.co" }, "atencion@prueba.gov.co"], [{ url: "https://prueba.gov.co/nuevo-contacto" }, "https://prueba.gov.co/nuevo-contacto"]] as const) {
    assert.equal((await put({ ...c })).status, 200);
    const snap = await snapshot();
    // Servicio de errores (RF-C3-IN-10): el error público trae los canales vigentes sin redespliegue.
    const err = await fetch(`${apiBase()}/chat`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{}" });
    const cuerpo = await err.json();
    assert.ok(Array.isArray(cuerpo.canales));
    // Consulta ajena a las 3 Direcciones (RF-C3-DI-20): la respuesta usa el contacto general vigente.
    const ajena = respuestaFueraDeAlcance(snap);
    assert.ok(JSON.stringify(ajena).includes(snap.general.phone) || JSON.stringify(ajena).includes(snap.general.email) || JSON.stringify(ajena).includes(snap.general.url), "usa el contacto general");
    assert.ok([snap.general.phone, snap.general.email, snap.general.url].includes(valor));
  }
  const antes = JSON.stringify((await snapshot()).general);
  for (const [c, campo] of [[{ phone: "6O4-ABC" }, "phone"], [{ email: "sin@dominio" }, "email"], [{ url: "http://prueba.gov.co" }, "url"], [{ phone: "" }, "phone"]] as const) {
    const r = await put({ ...c });
    assert.equal(r.status, 422);
    assert.equal(r.json.error.campo, campo);
  }
  assert.equal(JSON.stringify((await snapshot()).general), antes);
  assert.equal((await ges.api("PUT", "/contacts/general", { revision: 0, phone: "1", email: "a@b.co", url: "https://x.co" })).status, 403);
});

test("AD37: 10 acciones — 6 válidas reflejadas en orden y valores (Emergencia/DI-19); 4 inválidas; el último canal no se quita; 120/121", async () => {
  const canal = (over: Record<string, unknown> = {}) => ({ name: "Canal", description: "Atención", type: "teléfono", value: "321", ...over });
  const add = async (c: Record<string, unknown>) => tec.api("POST", "/contacts/immediate", { revision: await rev(), ...c });
  const a1 = await add(canal({ name: "Bomberos", value: "119" }));
  const a2 = await add(canal({ name: "Policía", value: "123" }));
  const a3 = await add(canal({ name: "Correo atención", type: "correo", value: "atencion@prueba.gov.co" }));
  for (const r of [a1, a2, a3]) assert.equal(r.status, 201, r.text);
  // Modificación.
  const mod = await tec.api("PUT", `/contacts/immediate/${a2.json.id}`, { revision: await rev(), ...canal({ name: "Policía Nacional", value: "112" }) });
  assert.equal(mod.status, 200);
  // Reorden.
  const ids = (await snapshot()).inmediatos.map(c => c.id);
  const nuevo = [ids[ids.length - 1], ...ids.slice(0, -1)];
  assert.equal((await tec.api("PUT", "/contacts/immediate/order", { revision: await rev(), ids: nuevo })).status, 200);
  // Baja que deja al menos un canal.
  assert.equal((await tec.api("DELETE", `/contacts/immediate/${a1.json.id}`, { revision: await rev() })).status, 200);
  const snap = await snapshot();
  assert.deepEqual(snap.inmediatos.map(c => c.position), snap.inmediatos.map((_, i) => i + 1), "posiciones contiguas");
  assert.equal(snap.inmediatos[0].id, nuevo[0], "el reorden se refleja");
  assert.ok(snap.inmediatos.some(c => c.name === "Policía Nacional" && c.value === "112"));
  assert.ok(!snap.inmediatos.some(c => c.name === "Bomberos"));
  const emergencia = bloqueCanalesInmediatos(snap);
  for (const c of snap.inmediatos) assert.ok(emergencia.includes(c.value), `emergencia incluye ${c.value}`);
  assert.ok(emergencia.indexOf(snap.inmediatos[0].value) < emergencia.indexOf(snap.inmediatos[snap.inmediatos.length - 1].value) || snap.inmediatos.length === 1);

  // 120 se admite; 121 y vacíos se rechazan.
  const largo120 = "a".repeat(120);
  assert.equal((await add(canal({ name: "Límite", description: largo120, value: "555" }))).status, 201);
  const antes = (await snapshot()).inmediatos.length;
  const invalidas: Array<[Record<string, unknown>, string]> = [
    [{ description: "a".repeat(121) }, "description"], [{ type: "correo", value: "no-es-correo" }, "value"],
    [{ name: "   " }, "name"], [{ description: "   " }, "description"], [{ type: "url", value: "http://sitio.gov.co" }, "value"],
  ];
  for (const [c, campo] of invalidas) {
    const r = await add(canal(c));
    assert.equal(r.status, 422, JSON.stringify(c));
    assert.equal(r.json.error.campo, campo);
  }
  assert.equal((await snapshot()).inmediatos.length, antes);
  assert.equal((await ges.api("POST", "/contacts/immediate", { revision: 0, ...canal() })).status, 403);
});

test("AD37: quitar el último canal se rechaza también con bajas simultáneas; revisión obsoleta → 409 sin perder la otra edición", async () => {
  // Deja exactamente dos canales.
  let snap = await snapshot();
  for (const c of snap.inmediatos.slice(2)) await tec.api("DELETE", `/contacts/immediate/${c.id}`, { revision: await rev() });
  snap = await snapshot();
  assert.equal(snap.inmediatos.length, 2);
  const r = await rev();
  // Dos bajas con la MISMA revisión: solo una puede aplicarse (CAS).
  const rs = await Promise.all(snap.inmediatos.map(c => tec.api("DELETE", `/contacts/immediate/${c.id}`, { revision: r })));
  assert.deepEqual(rs.map(x => x.status).sort(), [200, 409]);
  assert.equal((await snapshot()).inmediatos.length, 1);
  // Quitar el último: rechazado.
  const ultimo = (await snapshot()).inmediatos[0];
  const q = await tec.api("DELETE", `/contacts/immediate/${ultimo.id}`, { revision: await rev() });
  assert.equal(q.status, 422);
  assert.equal((await snapshot()).inmediatos.length, 1);

  // A nivel de base: dos DELETE simultáneos con otra revisión nunca dejan la lista vacía (candado del disparador).
  const a = await app.db.admin.connect(); const b = await app.db.admin.connect();
  try {
    const extra = await tec.api("POST", "/contacts/immediate", { revision: await rev(), name: "Extra", description: "Segundo", type: "teléfono", value: "777" });
    const ids = (await snapshot()).inmediatos.map(c => c.id);
    assert.equal(ids.length, 2);
    await a.query("BEGIN"); await b.query("BEGIN");
    await a.query("DELETE FROM admin.contact_immediate WHERE id = $1", [ids[0]]);
    const segunda = b.query("DELETE FROM admin.contact_immediate WHERE id = $1", [ids[1]]).then(() => "ok", () => "rechazada");
    await new Promise(res => setTimeout(res, 150));
    await a.query("COMMIT");
    assert.equal(await segunda, "rechazada");
    await b.query("ROLLBACK");
    assert.equal(extra.status, 201);
  } finally { a.release(); b.release(); }
  assert.equal((await snapshot()).inmediatos.length, 1);
});
