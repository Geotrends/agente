/**
 * Construcción de la aplicación Express (sin escuchar ni registrar manejadores de proceso).
 *
 * Vive aparte de `index.ts` para que las pruebas de integración ejerciten el MISMO orden de
 * middleware que producción: contexto de recepción → guardas de origen → CORS → cuerpo → rutas.
 */
import cors from "cors";
import express from "express";
import helmet from "helmet";
import authRouter from "./routes/auth.js";
import healthRouter from "./routes/health.js";
import chatRouter from "./routes/chat.js";
import feedbackRouter from "./routes/feedback.js";
import chatConfigRouter from "./routes/chatConfig.js";
import conversationsRouter from "./routes/conversations.js";
import adminAuthRouter from "./routes/adminAuth.js";
import adminAccountsRouter from "./routes/adminAccounts.js";
import adminDocumentsRouter from "./routes/adminDocuments.js";
import adminLinksRouter from "./routes/adminLinks.js";
import adminDataRouter from "./routes/adminData.js";
import adminContactsRouter from "./routes/adminContacts.js";
import adminOperationsRouter from "./routes/adminOperations.js";
import { CHAT_PATH, originGuard, preflightGuard } from "./chat/perimeter.js";
import { receptionMiddleware } from "./chat/reception.js";
import { wireOperationalEvents } from "./chat/runtime.js";
import { sendError, setCanalesProvider } from "./chat/errors.js";
import { readContactSnapshot } from "./admin/contacts.js";
import { hasDuplicateKeys } from "./admin/validation.js";
import { chatPool } from "./chat/db.js";
import { parseOrigins } from "./services/diConfig.js";
import { setting } from "./services/settings.js";
import { safeErrorCode } from "./services/safeLog.js";
import { parseTrustProxy } from "./services/trustProxy.js";

export function createApp(): express.Express {
  // Cableado de eventos operativos (indisponibilidad, estado de modelos) antes de aceptar tráfico.
  wireOperationalEvents();
  const app = express();
  // Sin ETag/Last-Modified: las respuestas del chat son no-store y no deben validarse de forma condicional.
  app.disable("etag");
  app.disable("x-powered-by");

  // Detrás de un proxy inverso, la IP del cliente viene en X-Forwarded-For: sin
  // esto, todos los límites de tasa por IP verían la del proxy y contarían a
  // todo el mundo como un solo cliente (C-1).
  // Se interpreta una vez y tipado: un número son saltos confiables (no la cadena "1", que Express
  // leería como una dirección), o una lista exacta de proxies. «Confiar en todos» se rechaza.
  const trust = parseTrustProxy(process.env.TRUST_PROXY);
  if (trust.problems.length) console.error(`[proxy] ${trust.problems.join("; ")}: se ignora y no se confía en ningún proxy.`);
  if (trust.value !== false) app.set("trust proxy", trust.value);

  /**
   * Aviso, una sola vez, de que la cadena de proxies no coincide con TRUST_PROXY.
   *
   * Con un proxy más delante del que se declara (Traefik de Dokploy delante del
   * nginx del frontend, con TRUST_PROXY=1), `req.ip` es la IP de ese proxy para
   * todo el mundo: el límite de sesiones y la cuota diaria "por IP" pasan a ser
   * globales y se agotan en minutos. El síntoma en el navegador era un 429 en
   * /api/session que la interfaz mostraba como "No pude conectar con el backend".
   * Solo se registran conteos, nunca direcciones.
   */
  const trustedHops = typeof trust.value === "number" ? trust.value : 0;
  if (trustedHops > 0) {
    let warned = false;
    app.use((req, _res, next) => {
      if (!warned) {
        const hops = (req.header("x-forwarded-for") ?? "").split(",").filter(part => part.trim()).length;
        if (hops > trustedHops) {
          warned = true;
          console.warn(`[proxy] X-Forwarded-For trae ${hops} saltos pero TRUST_PROXY=${trustedHops}: `
            + "la IP de los clientes probablemente es la de un proxy. Sube TRUST_PROXY al número de proxies reales.");
        }
      }
      next();
    });
  }

  // Orden de recepción (RNF-C3-IN-04/12): contexto y no-store → preflight/origen exactos → CORS.
  // Ninguna solicitud del chat toca la sesión, el modelo o el registro antes de pasar estas guardas.
  app.use(receptionMiddleware());
  app.use(preflightGuard());
  app.use((req, res, next) => (CHAT_PATH.test(req.path) && req.method !== "OPTIONS" ? originGuard()(req, res, next) : next()));

  app.use(helmet());

  /**
   * Orígenes permitidos. `cors()` sin argumentos ponía
   * `Access-Control-Allow-Origin: *`, que es lo que permitía llamar al API desde
   * cualquier página. Sin `ALLOWED_ORIGINS` configurado no se habilita ningún
   * origen cruzado: el frontend servido desde el mismo host sigue funcionando y
   * cualquier otro queda fuera, que es el defecto correcto.
   */
  const allowedOrigins = [
    ...(process.env.ALLOWED_ORIGINS ?? "").split(",").map(o => o.trim()).filter(Boolean),
    ...parseOrigins(setting("chatAllowedOrigins")),
  ];
  app.use(cors({
    origin: allowedOrigins.length ? allowedOrigins : false,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization", "x-csrf-token", "idempotency-key"],
    maxAge: 600,
  }));

  // Límite explícito de cuerpo para el resto de la API (panel, sesión). El chat
  // ciudadano NO pasa por aquí: su perímetro lee el cuerpo con tope de 128 KiB en
  // bytes y sin límite adicional de caracteres (RNF-C3-IN-06), ver chat/perimeter.ts.
  // El panel rechaza claves JSON repetidas (JSON.parse se queda con la última en silencio).
  const generalJson = express.json({
    limit: "64kb",
    verify: (_req, _res, buf) => {
      if (buf.length && hasDuplicateKeys(buf.toString("utf8"))) throw Object.assign(new Error("claves duplicadas"), { status: 400 });
    },
  });
  app.use((req, res, next) => (CHAT_PATH.test(req.path) ? next() : generalJson(req, res, next)));

  // Los errores públicos nunca llevan SQL, proveedor ni trazas; los canales vigentes
  // salen del snapshot de contactos.
  setCanalesProvider(async budget => (await readContactSnapshot(chatPool(), budget))?.inmediatos ?? []);

  // /health y /ready, fuera del limitador y sin token a propósito: son lo que
  // consultan el HEALTHCHECK de Docker y el monitor externo (ver routes/health.ts).
  app.use(healthRouter);

  // Emisión de sesiones: tiene sus propios límites, más estrictos.
  app.use("/api", authRouter);
  app.use("/api", chatConfigRouter);
  app.use("/api", conversationsRouter);
  app.use("/api", chatRouter);
  app.use("/api", feedbackRouter);
  app.use("/api", adminAuthRouter);
  app.use("/api", adminAccountsRouter);
  app.use("/api", adminDocumentsRouter);
  app.use("/api", adminLinksRouter);
  app.use("/api", adminDataRouter);
  app.use("/api", adminContactsRouter);
  app.use("/api", adminOperationsRouter);

  // Cualquier error no previsto se traduce a un código de catálogo, sin detalle interno.
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) { next(error); return; }
    const status = (error as { status?: number })?.status;
    if (status === 400 || (error as { type?: string })?.type === "entity.parse.failed") {
      void sendError(res, "VALIDACION", { mensaje: "El cuerpo no es JSON válido." });
      return;
    }
    if (status === 413) { void sendError(res, "CUERPO_EXCESIVO"); return; }
    console.error("[http]", safeErrorCode(error));
    void sendError(res, "ERROR_INTERNO");
  });
  return app;
}
