/** SPEC008 US7 (FR-018): sesión absoluta de 8 h, bloqueo por /64 y límite al cambio de contraseña. */
import test from "node:test";
import assert from "node:assert/strict";
import { PASSWORD, startAdminApp, TECNICO, type AdminApp } from "./support.js";

let app: AdminApp;
test.before(async () => {
  app = await startAdminApp();
  await app.createAccount("tec.s008s@prueba.gov.co", TECNICO);
});
test.after(async () => { await app.close(); });

test("la sesión vence a las 8 h de su creación aunque haya actividad continua", async () => {
  const s = await app.login("tec.s008s@prueba.gov.co", PASSWORD, "10.8.0.1");
  // Actividad cada 25 minutos (siempre dentro de los 30 de inactividad) durante 7 h 55 min.
  for (let minutos = 25; minutos <= 7 * 60 + 50; minutos += 25) {
    app.clock.t += 25 * 60_000;
    assert.equal((await s.api("GET", "/session")).status, 200, `a los ${minutos} min sigue vigente`);
  }
  app.clock.t += 25 * 60_000; // 7 h 55 min: todavía vigente
  assert.equal((await s.api("GET", "/session")).status, 200);
  app.clock.t += 25 * 60_000; // 8 h 20 min: pasa de la vigencia absoluta con actividad reciente
  assert.equal((await s.api("GET", "/session")).status, 401, "vencida por vigencia absoluta");
  // Iniciar sesión de nuevo es posible.
  const otra = await app.login("tec.s008s@prueba.gov.co", PASSWORD, "10.8.0.1");
  assert.equal((await otra.api("GET", "/session")).status, 200);
});

test("los intentos desde un mismo /64 de IPv6 cuentan como un solo origen", async () => {
  // 20 fallos desde 20 direcciones distintas del mismo /64 → bloqueo de la IP.
  for (let i = 0; i < 20; i++) {
    const r = await app.rawLogin("nadie@prueba.gov.co", "incorrecta-123456", `2001:db8:abcd:12::${(i + 1).toString(16)}`);
    assert.equal(r.status, 401, `intento ${i + 1}`);
  }
  const bloqueada = await app.rawLogin("nadie@prueba.gov.co", "incorrecta-123456", "2001:db8:abcd:12:ffff::9");
  assert.equal(bloqueada.status, 429, "otra dirección del mismo /64 queda bloqueada");
  const otroSegmento = await app.rawLogin("nadie@prueba.gov.co", "incorrecta-123456", "2001:db8:abcd:13::1");
  assert.equal(otroSegmento.status, 401, "otro /64 no se ve afectado");
});

test("cambiar la contraseña no permite adivinar la actual sin límite: 5 fallos bloquean 15 minutos", async () => {
  await app.createAccount("tec.s008p2@prueba.gov.co", TECNICO);
  const s = await app.login("tec.s008p2@prueba.gov.co", PASSWORD, "10.8.0.2");
  for (let i = 0; i < 5; i++) {
    const r = await s.api("POST", "/password", { currentPassword: `incorrecta-${i}-123456`, newPassword: "otra-contraseña-segura-1" });
    assert.ok([401, 422].includes(r.status), `fallo ${i + 1}: ${r.status}`);
  }
  const conLaCorrecta = await s.api("POST", "/password", { currentPassword: PASSWORD, newPassword: "otra-contraseña-segura-1" });
  assert.ok([401, 422, 429].includes(conLaCorrecta.status), "bloqueada aunque la actual sea correcta");
  assert.match(JSON.stringify(conLaCorrecta.json), /intentos|Demasiados/i);
  // Tras 15 minutos se puede intentar de nuevo (la sesión también debe seguir vigente: renovarla).
  app.clock.t += 16 * 60_000;
  const s2 = await app.login("tec.s008p2@prueba.gov.co", PASSWORD, "10.8.0.2");
  const ok = await s2.api("POST", "/password", { currentPassword: PASSWORD, newPassword: "otra-contraseña-segura-1" });
  assert.equal(ok.status, 204, ok.text);
});
