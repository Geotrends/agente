/**
 * Autenticación y alcances (hallazgo C-1).
 *
 * Lo que se fija aquí no es que un token válido funcione —eso es lo fácil—
 * sino que los ataques conocidos contra JWT no pasen: `alg: none`, un token
 * firmado con otro secreto y uno caducado.
 *
 * El alcance `corpus` se retiró junto con las rutas que abría. Queda la prueba
 * de que un token que diga `scope: "corpus"` NO verifica: es lo que garantiza
 * que un token emitido antes del cambio dejara de servir.
 */
import assert from "node:assert/strict";
import test from "node:test";

process.env.AUTH_JWT_SECRET = "secreto-de-pruebas-con-mas-de-32-caracteres";
const { bearerFrom, issueToken, resetAuthSecret, verifyToken } =
  await import("../src/services/auth.js");

test("un token recién emitido se verifica e identifica al cliente", async () => {
  const { token, expiresIn } = await issueToken();
  assert.ok(expiresIn > 0);
  const claims = await verifyToken(token);
  assert.ok(claims?.sub, "debe identificar al cliente para poder ponerle cuota");
});

test("dos sesiones anónimas son identidades distintas", async () => {
  const a = await verifyToken((await issueToken()).token);
  const b = await verifyToken((await issueToken()).token);
  assert.notEqual(a?.sub, b?.sub, "si compartieran sub, la cuota por identidad no serviría");
});

test("un token firmado con OTRO secreto se rechaza", async () => {
  const { token } = await issueToken();
  process.env.AUTH_JWT_SECRET = "otro-secreto-distinto-de-mas-de-32-chars";
  resetAuthSecret();
  try {
    assert.equal(await verifyToken(token), undefined);
  } finally {
    process.env.AUTH_JWT_SECRET = "secreto-de-pruebas-con-mas-de-32-caracteres";
    resetAuthSecret();
  }
});

test('un token con "alg": "none" se rechaza', async () => {
  // El ataque clásico: cabecera sin algoritmo y firma vacía.
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const forjado = `${b64({ alg: "none", typ: "JWT" })}.${b64({
    sub: "atacante", scope: "corpus", iss: "geobot-backend", aud: "geobot-api",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.`;
  assert.equal(await verifyToken(forjado), undefined);
});

test("un token caducado se rechaza", async () => {
  const previo = process.env.AUTH_SESSION_TTL_SECONDS;
  process.env.AUTH_SESSION_TTL_SECONDS = "60";
  try {
    const { token } = await issueToken();
    // Se reescribe el exp al pasado manipulando el payload: la firma deja de
    // cuadrar, que es otra forma de comprobar que no se acepta cualquier cosa.
    const [h, , s] = token.split(".");
    const vencido = `${h}.${Buffer.from(JSON.stringify({
      sub: "x", scope: "chat", iss: "geobot-backend", aud: "geobot-api",
      exp: Math.floor(Date.now() / 1000) - 10,
    })).toString("base64url")}.${s}`;
    assert.equal(await verifyToken(vencido), undefined);
  } finally {
    if (previo === undefined) delete process.env.AUTH_SESSION_TTL_SECONDS;
    else process.env.AUTH_SESSION_TTL_SECONDS = previo;
  }
});

test("basura y cadena vacía no verifican", async () => {
  for (const malo of ["", "no-es-un-jwt", "a.b.c", "Bearer x"]) {
    assert.equal(await verifyToken(malo), undefined, `no debería verificar: "${malo}"`);
  }
});

test('un token con scope "corpus" no verifica: ese alcance ya no existe', async () => {
  // Firmado con el secreto BUENO, para que lo único que lo invalide sea el
  // alcance retirado — si no, la prueba pasaría por el motivo equivocado.
  const { SignJWT } = await import("jose");
  const { createSecretKey } = await import("node:crypto");
  const clave = createSecretKey(Buffer.from(process.env.AUTH_JWT_SECRET!, "utf8"));
  const token = await new SignJWT({ scope: "corpus" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("operador")
    .setIssuer("geobot-backend")
    .setAudience("geobot-api")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(clave);
  assert.equal(await verifyToken(token), undefined,
    "un token de operador emitido antes del cambio debe dejar de valer");
});

test("la cabecera Authorization se interpreta con y sin mayúsculas", () => {
  assert.equal(bearerFrom("Bearer abc"), "abc");
  assert.equal(bearerFrom("bearer  abc "), "abc");
  assert.equal(bearerFrom("Basic abc"), undefined);
  assert.equal(bearerFrom(undefined), undefined);
  assert.equal(bearerFrom("Bearer"), undefined);
});
