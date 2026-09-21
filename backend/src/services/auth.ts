/**
 * Autenticación por JWT y alcances (hallazgo C-1).
 *
 * El servicio no tenía nada delante: cualquiera que alcanzara el puerto podía
 * enumerar los 6.295 documentos, descargar cualquiera de ellos y ejecutar
 * `/api/chat` sin límite — con cuatro claves de API facturables detrás, y con
 * cada petición pudiendo colgarse hasta 240 s.
 *
 * El modelo de identidad viene dado por lo que es el producto: un canal de
 * atención **público**. Pedirle al ciudadano que se registre para preguntar
 * por un trámite añadiría fricción donde no debe haberla, y convertiría el
 * padrón de usuarios en otra base de datos personales bajo la Ley 1581 —justo
 * lo que A-11 trabaja por acotar—. Queda un solo tipo de sesión:
 *
 *   chat  — sesión ANÓNIMA que el propio backend emite sin pedir nada. No
 *           identifica a una persona; identifica a un cliente, que es lo que
 *           hace falta para poner cuota, revocar y distinguir un navegador de
 *           un bucle de `curl`. No impide a un atacante decidido pedir mil
 *           sesiones; sí acota el costo y le quita lo trivial.
 *
 * Existió un segundo alcance, `corpus`, para las rutas que listaban y
 * descargaban documentos. Esas rutas se retiraron con la interfaz que las
 * consumía, así que el alcance se fue con ellas: mantener un token que no abre
 * nada solo deja superficie de ataque sin contrapartida. El claim `scope` sigue
 * viajando en el token y se sigue verificando, de modo que cualquier token
 * `corpus` emitido antes de este cambio deja de valer.
 *
 * Se usa `jose` en vez de implementar HS256 a mano. Es la excepción razonada a
 * la política de dependencias de A-10: verificar un JWT tiene trampas
 * conocidas —el algoritmo `none`, la comparación no constante, la confusión de
 * algoritmos— y equivocarse en cualquiera de ellas deja la puerta abierta
 * mientras todo parece funcionar. Una dependencia vetada vale más que código
 * de seguridad propio.
 */
import { createSecretKey, randomUUID, type KeyObject } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { setting } from "./settings.js";

/**
 * Lo único que el backend necesita saber del portador: qué cliente es, para
 * poder ponerle cuota. El alcance no se expone porque ya no hay nada que
 * decidir con él — `verifyToken` lo exige y ahí termina su papel.
 */
export type SessionClaims = {
  sub: string;
};

/** Único alcance emitido y aceptado. Se sigue verificando: ver la cabecera. */
const SCOPE = "chat";

const ISSUER = "geobot-backend";
const AUDIENCE = "geobot-api";
const ALGORITHM = "HS256";

let cachedSecret: { value: string; key: KeyObject } | undefined;

/**
 * Clave de firma. Sin ella el servicio NO arranca en producción: un secreto
 * por defecto es lo mismo que no tener autenticación, solo que aparentándola.
 *
 * En desarrollo se genera uno efímero para no obligar a configurar nada antes
 * de poder levantar el proyecto; como cambia en cada arranque, los tokens de
 * la ejecución anterior dejan de valer, que es el comportamiento correcto.
 */
function secretKey(): KeyObject {
  const configured = process.env.AUTH_JWT_SECRET?.trim();
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_JWT_SECRET es obligatorio en producción: sin él la autenticación es decorativa.");
    }
    if (!cachedSecret) {
      const value = randomUUID() + randomUUID();
      console.warn("[auth] AUTH_JWT_SECRET no está definido; se usa un secreto efímero de desarrollo. Los tokens no sobreviven a un reinicio.");
      cachedSecret = { value, key: createSecretKey(Buffer.from(value, "utf8")) };
    }
    return cachedSecret.key;
  }
  if (configured.length < 32) {
    throw new Error("AUTH_JWT_SECRET debe tener al menos 32 caracteres.");
  }
  if (cachedSecret?.value !== configured) {
    cachedSecret = { value: configured, key: createSecretKey(Buffer.from(configured, "utf8")) };
  }
  return cachedSecret.key;
}

/** Solo para pruebas: olvida la clave memorizada tras cambiar el entorno. */
export function resetAuthSecret(): void {
  cachedSecret = undefined;
}

/** Vida del token de sesión, en segundos. Declarada en el registro de M-8. */
function sessionTtlSeconds(): number {
  return setting("authSessionTtlSeconds");
}

export async function issueToken(subject: string = randomUUID()): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = sessionTtlSeconds();
  const token = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(subject)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .setJti(randomUUID())
    .sign(secretKey());
  return { token, expiresIn };
}

/**
 * Verifica y devuelve los claims, o `undefined` si el token no sirve.
 *
 * `algorithms` se fija explícitamente: es lo que cierra la confusión de
 * algoritmos y el `alg: none`. `issuer` y `audience` impiden que valga aquí un
 * token emitido para otra cosa con el mismo secreto.
 */
export async function verifyToken(token: string): Promise<SessionClaims | undefined> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (payload.scope !== SCOPE) return undefined;
    if (typeof payload.sub !== "string" || !payload.sub) return undefined;
    return { sub: payload.sub };
  } catch {
    return undefined;
  }
}

/** Extrae el token de `Authorization: Bearer <token>`. */
export function bearerFrom(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}
