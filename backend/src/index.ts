import "dotenv/config";
import { createApp } from "./app.js";
import { shutdownRetrieval, warmUpRetrieval } from "./services/retrievalClient.js";
import { describeSettings } from "./services/settings.js";
import { registerProcessGuards } from "./services/processGuards.js";
import { safeErrorCode } from "./services/safeLog.js";
import { forbiddenCredentialEnv } from "./services/diConfig.js";

// Principio V: en producción no se arranca con credenciales de otro proveedor ni llaves estáticas.
// Solo se nombran las variables, nunca su valor. Compose ya las vacía para este servicio.
if (process.env.NODE_ENV === "production") {
  const sobrantes = forbiddenCredentialEnv();
  if (sobrantes.length) {
    console.error(`[config] Arranque rechazado: elimine del entorno ${sobrantes.join(", ")}. Solo se admite Bedrock con el rol de la instancia.`);
    process.exit(1);
  }
  if (!process.env.ADMIN_IP_HMAC_SECRET?.trim()) {
    console.error("[config] Arranque rechazado: falta ADMIN_IP_HMAC_SECRET (obligatorio en producción, distinto de AUTH_JWT_SECRET).");
    process.exit(1);
  }
}

const app = createApp();
const port = Number(process.env.PORT || 4000);

const server = app.listen(port, () => {
  // Small runtime log for local development.
  console.log(`Agent backend running on http://localhost:${port}`);
  console.log(`Node runtime: ${process.version}`);
  // Qué configuración está realmente en vigor (M-8). Sin esto, averiguar por
  // qué dos máquinas se comportan distinto exigía leer ocho archivos.
  const overridden = describeSettings().filter(s => s.source === "entorno");
  console.log(overridden.length
    ? `[config] ${overridden.length} variable(s) desde el entorno: ${overridden.map(s => `${s.env}=${s.value}`).join(", ")}`
    : "[config] Toda la configuración usa sus valores por defecto.");
  // Arranca el worker de recuperación y deja el índice cargado (desde el
  // snapshot, menos de un segundo) para que la primera consulta no lo pague.
  //
  // Si falla, se reintenta con retroceso en vez de dejar el proceso arriba
  // devolviendo 503 para siempre (hallazgo M-12): antes había que reiniciar a
  // mano y nadie se enteraba hasta que un usuario lo reportaba.
  void warmUpWithRetry();
});

/**
 * Precalentamiento con reintentos espaciados.
 *
 * No aborta el arranque si falla: el servicio sigue en pie respondiendo 503 en
 * `/api/chat` y `ok` en `/health`, que es lo que permite al monitoreo externo
 * distinguir "proceso muerto" de "índice no disponible". Lo que cambia es que
 * ahora vuelve a intentarlo solo.
 */
async function warmUpWithRetry(attempt = 1): Promise<void> {
  const MAX_ATTEMPTS = 5;
  try {
    await warmUpRetrieval();
    if (attempt > 1) console.log(`[retrieval] Índice disponible tras ${attempt} intentos.`);
  } catch (error) {
    console.error(`[retrieval] No se pudo precalentar el índice (intento ${attempt}/${MAX_ATTEMPTS}): ${safeErrorCode(error)}`);
    if (attempt >= MAX_ATTEMPTS) {
      console.error("[retrieval] Se agotaron los reintentos. El servicio sigue arriba, pero /api/chat responderá 503 hasta que se corrija la causa.");
      return;
    }
    const delay = Math.min(30_000 * 2 ** (attempt - 1), 5 * 60_000);
    setTimeout(() => void warmUpWithRetry(attempt + 1), delay).unref();
  }
}

// Red de seguridad del proceso: ver services/processGuards.ts (solo códigos acotados en el log).
registerProcessGuards({ onFatal: (reason, code) => void shutdown(reason, code) });

let shuttingDown = false;

/**
 * Apagado ordenado: deja de aceptar conexiones, espera a las que están en
 * curso y libera el worker con sus sesiones ONNX.
 *
 * El temporizador de gracia evita el otro extremo: una petición colgada no
 * puede impedir indefinidamente que el proceso muera cuando el orquestador ya
 * pidió que lo hiciera.
 */
async function shutdown(signal: string, code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[proceso] ${signal} recibido; cerrando.`);
  const force = setTimeout(() => {
    console.error("[proceso] El cierre ordenado no terminó a tiempo; se fuerza la salida.");
    process.exit(code || 1);
  }, 10_000);
  force.unref();
  try {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await shutdownRetrieval();
  } catch (error) {
    console.error(`[proceso] Error durante el cierre: ${safeErrorCode(error)}`);
  } finally {
    clearTimeout(force);
    process.exit(code);
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => void shutdown(signal));
}
