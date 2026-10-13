/**
 * Servidor de pruebas E2E del panel (SPEC007 T004/T016).
 *
 * Una sola página de origen: sirve el export estático de Next (`out/`) y reenvía `/api` a la API
 * REAL (`createApp`) sobre una base PostgreSQL aislada con los roles/migraciones de producción.
 * Expone `/__test/*` SOLO aquí (nunca en la aplicación): crear cuentas, adelantar el reloj y leer
 * contadores seguros. Cada arranque crea y destruye su propia base; no hay datos reales.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.E2E_ADMIN_PORT ?? 4320);
process.env.E2E_ADMIN_ORIGIN = `http://localhost:${PORT}`;
const root = fileURLToPath(new URL("../../..", import.meta.url));
const out = join(root, "out-admin");

const { startAdminApp } = await import("../../../../backend/test/admin-integracion/support.js");
const { resetIpThrottle } = await import("../../../../backend/src/admin/auth.js");
const app = await startAdminApp({ qdrant: true });
const { procesarCargasManuales } = await import("../../../../backend/src/kb/manualUploads.js");
const { procesarOperaciones } = await import("../../../../backend/src/kb/documentOperations.js");
const { notificar } = await import("../../../../backend/src/kb/notifications.js");
const apiBase = app.base.replace(/\/admin$/, "");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain",
};

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of req) parts.push(c as Buffer);
  return Buffer.concat(parts);
}

async function proxy(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const body = ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : await readBody(req);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string" && !["host", "connection", "content-length"].includes(k)) headers[k] = v;
  }
  const r = await fetch(`${apiBase}${path}`, { method: req.method, headers, body: body as BodyInit | undefined, redirect: "manual" });
  res.statusCode = r.status;
  r.headers.forEach((v, k) => { if (!["content-encoding", "transfer-encoding", "content-length"].includes(k) && k !== "set-cookie") res.setHeader(k, v); });
  const cookies = r.headers.getSetCookie?.() ?? [];
  if (cookies.length) res.setHeader("set-cookie", cookies);
  res.end(Buffer.from(await r.arrayBuffer()));
}

async function resolveFile(path: string): Promise<string | null> {
  const clean = normalize(path).replace(/^(\.\.[\\/])+/, "");
  for (const candidate of [clean, `${clean}.html`, join(clean, "index.html")]) {
    const full = join(out, candidate);
    if (!full.startsWith(out)) continue;
    try { if ((await stat(full)).isFile()) return full; } catch { /* siguiente */ }
  }
  return null;
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (url.pathname === "/__ready") { res.writeHead(200).end("ok"); return; }
    if (url.pathname === "/__test/account" && req.method === "POST") {
      const b = JSON.parse((await readBody(req)).toString("utf8")) as { email: string; perfil: string; password?: string; mustChange?: boolean; name?: string };
      const id = await app.createAccount(b.email, b.perfil as "administrador técnico", { password: b.password, mustChange: b.mustChange, name: b.name });
      json(res, 200, { id });
      return;
    }
    if (url.pathname === "/__test/only-technical" && req.method === "POST") {
      // Deja a `id` como único técnico activo (los demás pasan a Gestor) para probar la salvaguarda.
      const b = JSON.parse((await readBody(req)).toString("utf8")) as { id: string };
      await app.db.migrator.query(
        "UPDATE admin.account SET profile = 'Gestor documental' WHERE profile = 'administrador técnico' AND id <> $1", [b.id]);
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/__test/interaction" && req.method === "POST") {
      // Siembra una interacción autorizada (y su valoración) como la dejaría el registro real.
      const b = JSON.parse((await readBody(req)).toString("utf8")) as {
        tipo: string; categoria: string; pregunta: string; respuesta: string; hace?: string; valoracion?: string; motivo?: string; purgada?: boolean;
      };
      const { rows: [i] } = await app.db.migrator.query(
        `INSERT INTO chat.interaction (response_id, received_at, category, question_text, answer_text, result_type, duration_ms,
                                       visible_output_tokens, model, input_tokens, output_tokens, purged_at)
         VALUES ($1, now() - $2::interval, $3, $4, $5, $6, 100, 10, 'gpt-oss-20b', 1, 1, $7) RETURNING row_id`,
        [b.purgada ? null : (await import("node:crypto")).randomUUID(), b.hace ?? "1 hour", b.categoria, b.purgada ? null : b.pregunta,
          b.purgada ? null : b.respuesta, b.tipo, b.purgada ? new Date() : null]);
      if (b.valoracion) {
        await app.db.migrator.query("INSERT INTO chat.valoracion (interaction_row_id, valoracion, motivo) VALUES ($1,$2,$3)", [i.row_id, b.valoracion, b.motivo ?? null]);
      }
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/__test/tariffs" && req.method === "POST") {
      // Tarifa vigente inicial de los dos modelos (la carga real la hace la operación; aquí es sintética).
      for (const m of ["openai.gpt-oss-20b-1:0", "openai.gpt-oss-120b-1:0"]) {
        await app.db.migrator.query(
          `INSERT INTO chat.tariff (model_id, region, currency, input_price_per_million, output_price_per_million, valid_from, source_url)
           SELECT $1, 'us-east-1', 'USD', 0.07, 0.3, '2026-01-01', 'https://aws.amazon.com/bedrock/pricing/'
            WHERE NOT EXISTS (SELECT 1 FROM chat.tariff WHERE model_id = $1 AND valid_to IS NULL)`, [m]);
      }
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/__test/volumen" && req.method === "POST") {
      // Volumen contractual SINTÉTICO (RNF-C3-AD-08): 1.000 documentos, 100.000 interacciones y 10.000 auditorías.
      const m = app.db.migrator;
      await m.query(`
        INSERT INTO kb.kb_elemento (clave, nombre, tipo, direccion, url_origen, estado, formato_original, procedimientos_origen, fuente, origen)
        SELECT 'https://ambientometroenvigado.com/v/' || g, 'Documento sintético ' || g, 'pagina', 'ecosistemas',
               'https://ambientometroenvigado.com/v/' || g, 'publicado', 'html', ARRAY['Ambientómetro'], 'ambientometro', 'scraper'
          FROM generate_series(1, 1000) g ON CONFLICT (clave) DO NOTHING`);
      await m.query(`
        INSERT INTO chat.interaction (response_id, received_at, category, question_text, answer_text, result_type, cited_documents,
                                      duration_ms, visible_output_tokens, model, input_tokens, output_tokens)
        SELECT gen_random_uuid(), now() - (g % 300 || ' days')::interval - (g % 86400 || ' seconds')::interval,
               (ARRAY['Ecosistemas','Bienestar Animal','Gestión Ambiental'])[1 + g % 3], 'Pregunta sintética ' || g, 'Respuesta sintética ' || g,
               (ARRAY['respondida','respondida','respondida','sin información','fuera de alcance'])[1 + g % 5],
               CASE WHEN g % 3 = 0 THEN '[{"id":"d1","nombre":"Documento sintético 1","enlace":"https://x.gov.co","fecha":"2026-01-01"}]'::jsonb ELSE '[]'::jsonb END,
               500, 100, 'gpt-oss-20b', 800, 300
          FROM generate_series(1, 100000) g`);
      await m.query(`
        INSERT INTO admin.audit (actor_account_id, action, object_type, object_id, result, occurred_at)
        SELECT NULL, 'documento.editar_metadata', 'documento', g::text, 'ok', now() - (g % 200 || ' days')::interval FROM generate_series(1, 10000) g`);
      await m.query("ANALYZE");
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/__test/notify" && req.method === "POST") {
      const b = JSON.parse((await readBody(req)).toString("utf8")) as { tipo: string; objeto: string; descripcion: string; propietario?: string };
      await notificar(app.kb, b.tipo as never, b.objeto, b.descripcion, { propietario: b.propietario ?? null });
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/__test/worker" && req.method === "POST") {
      // Equivale a un ciclo del kb-worker: conversión de cargas y operaciones documentales en cola.
      const cargas = await procesarCargasManuales(app.kb);
      const operaciones = await procesarOperaciones(app.kb);
      json(res, 200, { cargas, operaciones });
      return;
    }
    if (url.pathname === "/__test/reset" && req.method === "POST") {
      resetIpThrottle();
      await app.db.migrator.query("DELETE FROM admin.login_ip_guard");
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/__test/clock" && req.method === "POST") {
      const b = JSON.parse((await readBody(req)).toString("utf8")) as { advanceMs: number };
      app.clock.t += b.advanceMs;
      json(res, 200, { now: new Date(app.clock.t).toISOString() });
      return;
    }
    if (url.pathname.startsWith("/api/")) { await proxy(req, res, url.pathname.slice(4) + url.search); return; }
    const file = await resolveFile(url.pathname === "/" ? "/index.html" : url.pathname);
    if (!file) { res.writeHead(404, { "content-type": "text/plain" }).end("no encontrado"); return; }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(await readFile(file));
  } catch (error) {
    console.error("[adminServer]", error instanceof Error ? error.message : error);
    if (!res.headersSent) res.writeHead(500).end("error");
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`[adminServer] http://localhost:${PORT}`));

const shutdown = async () => { server.close(); await app.close().catch(() => {}); process.exit(0); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
