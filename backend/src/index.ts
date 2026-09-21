import "dotenv/config";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import authRouter from "./routes/auth.js";
import chatRouter from "./routes/chat.js";
import { shutdownRetrieval, warmUpRetrieval } from "./services/retrievalClient.js";
import { describeSettings } from "./services/settings.js";

const app = express();
const port = Number(process.env.PORT || 4000);

// Detrás de un proxy inverso, la IP del cliente viene en X-Forwarded-For: sin
// esto, todos los límites de tasa por IP verían la del proxy y contarían a
// todo el mundo como un solo cliente (C-1).
if (process.env.TRUST_PROXY?.trim()) app.set("trust proxy", process.env.TRUST_PROXY.trim());

app.use(helmet());

/**
 * Orígenes permitidos. `cors()` sin argumentos ponía
 * `Access-Control-Allow-Origin: *`, que es lo que permitía llamar al API desde
 * cualquier página. Sin `ALLOWED_ORIGINS` configurado no se habilita ningún
 * origen cruzado: el frontend servido desde el mismo host sigue funcionando y
 * cualquier otro queda fuera, que es el defecto correcto.
 */
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",").map(o => o.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : false,
  credentials: true,
}));

// Límite explícito de cuerpo: el defecto de express.json() son 100 KB, y una
// petición de chat legítima no pasa de unos pocos.
app.use(express.json({ limit: "64kb" }));

// Fuera del limitador y sin token a propósito: es lo que el monitoreo externo
// consulta para distinguir "proceso caído" de "índice no disponible".
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Emisión de sesiones: tiene sus propios límites, más estrictos.
app.use("/api", authRouter);
app.use("/api", chatRouter);

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
    console.error(`[retrieval] No se pudo precalentar el índice (intento ${attempt}/${MAX_ATTEMPTS}):`, error);
    if (attempt >= MAX_ATTEMPTS) {
      console.error("[retrieval] Se agotaron los reintentos. El servicio sigue arriba, pero /api/chat responderá 503 hasta que se corrija la causa.");
      return;
    }
    const delay = Math.min(30_000 * 2 ** (attempt - 1), 5 * 60_000);
    setTimeout(() => void warmUpWithRetry(attempt + 1), delay).unref();
  }
}

/**
 * Red de seguridad del proceso (hallazgo M-12).
 *
 * No había manejadores de `unhandledRejection` ni `uncaughtException`, así que
 * cualquier promesa rechazada sin capturar tumbaba el proceso sin dejar rastro
 * útil y sin supervisor que lo levantara. Se registran con contexto y NO se
 * sale: una promesa suelta en una ruta no justifica dejar sin servicio a todos
 * los demás. `uncaughtException` sí termina, porque tras él el estado del
 * proceso ya no es de fiar — pero de forma ordenada y con código distinto de
 * cero, que es lo que un supervisor necesita para reiniciar.
 */
process.on("unhandledRejection", reason => {
  console.error("[proceso] Promesa rechazada sin capturar:", reason);
});

process.on("uncaughtException", error => {
  console.error("[proceso] Excepción no capturada, cerrando de forma ordenada:", error);
  void shutdown("uncaughtException", 1);
});

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
    console.error("[proceso] Error durante el cierre:", error);
  } finally {
    clearTimeout(force);
    process.exit(code);
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => void shutdown(signal));
}
