/**
 * Medición de rendimiento del panel (SPEC007 T087; RNF-C3-AD-08).
 *
 *   node --import tsx scripts/eval-admin-performance.ts --manifest <archivo.json> [--dia 1|2] [--out <dir>]
 *
 * El manifiesto AUTORIZA el objetivo y nunca se infiere: no siembra producción implícitamente.
 *   { "entorno": "aislado-local" | "c6", "baseUrl": "https://…/api/admin", "muestras": 20,
 *     "emailEnv": "ADMIN_PERF_EMAIL", "passwordEnv": "ADMIN_PERF_PASSWORD", "release": "…" }
 *
 *  · entorno `aislado-local`: crea una base propia (PostgreSQL de pruebas), la siembra con el
 *    volumen contractual SINTÉTICO (1.000 / 100.000 / 10.000) y mide la API real. Es una verificación
 *    CONTROLADA: no acredita la medición del cliente.
 *  · entorno `c6`: solo MIDE un entorno ya poblado y autorizado (comprueba que los volúmenes
 *    contractuales estén presentes) y lo registra con fecha civil de Bogotá; la aceptación exige
 *    dos fechas distintas (T093).
 * La salida lleva conteos, tiempos y fechas; nunca credenciales ni textos.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { PANTALLAS, resumir, volumenCumple, type ResumenPantalla, type VolumenRequerido } from "./lib/adminPerformance.js";

type Manifiesto = {
  entorno: "aislado-local" | "c6"; baseUrl?: string; muestras?: number; emailEnv?: string; passwordEnv?: string; release?: string;
};

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const fechaBogota = (d = new Date()) => new Date(d.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);

async function medir(base: string, cookie: string, muestras: number): Promise<ResumenPantalla[]> {
  const out: ResumenPantalla[] = [];
  for (const p of PANTALLAS) {
    const tiempos: number[] = [];
    let errores = 0;
    for (let i = 0; i < muestras; i++) {
      const t0 = performance.now();
      try {
        const sep = p.ruta.includes("?") ? "&" : "?";
        const url = p.id.startsWith("tablero-") ? `${base}${p.ruta}${sep}from=2000-01-01&to=2099-12-31` : `${base}${p.ruta}`;
        const r = await fetch(url, { headers: { cookie, "cache-control": "no-cache" } });
        await r.arrayBuffer();
        if (!r.ok) errores++; else tiempos.push(performance.now() - t0);
      } catch { errores++; }
    }
    out.push(resumir(p.id, tiempos, errores));
  }
  return out;
}

async function volumenes(base: string, cookie: string): Promise<VolumenRequerido> {
  const get = async (ruta: string) => (await (await fetch(`${base}${ruta}`, { headers: { cookie } })).json()) as { total?: number };
  return {
    documentos: Number((await get("/documents?limit=1")).total ?? 0),
    interacciones: Number((await get("/interactions?limit=1&from=2000-01-01&to=2099-12-31")).total ?? 0),
    auditorias: Number((await get("/audit?limit=1")).total ?? 0),
  };
}

async function sembrarLocal(): Promise<{ base: string; cookie: string; cerrar: () => Promise<void> }> {
  const { startAdminApp, TECNICO, PASSWORD } = await import("../test/admin-integracion/support.js");
  const app = await startAdminApp();
  await app.createAccount("rendimiento@prueba.gov.co", TECNICO);
  const m = app.db.migrator;
  // Volumen contractual sintético, por SQL masivo (sin texto real ni identificadores ciudadanos).
  await m.query(`
    INSERT INTO kb.kb_elemento (clave, nombre, tipo, direccion, url_origen, estado, formato_original, procedimientos_origen, fuente, origen)
    SELECT 'https://ambientometroenvigado.com/p/' || g, 'Documento sintético ' || g, 'pagina', 'ecosistemas',
           'https://ambientometroenvigado.com/p/' || g, 'publicado', 'html', ARRAY['Ambientómetro'], 'ambientometro', 'scraper'
      FROM generate_series(1, 1000) g`);
  await m.query(`
    INSERT INTO chat.interaction (response_id, received_at, category, question_text, answer_text, result_type, cited_documents,
                                  duration_ms, visible_output_tokens, model, input_tokens, output_tokens)
    SELECT gen_random_uuid(), now() - (g % 300 || ' days')::interval - (g % 86400 || ' seconds')::interval,
           (ARRAY['Ecosistemas','Bienestar Animal','Gestión Ambiental'])[1 + g % 3],
           'Pregunta sintética ' || g, 'Respuesta sintética ' || g,
           (ARRAY['respondida','respondida','respondida','sin información','fuera de alcance'])[1 + g % 5],
           CASE WHEN g % 3 = 0 THEN '[{"id":"d1","nombre":"Documento sintético 1","enlace":"https://x.gov.co","fecha":"2026-01-01"}]'::jsonb ELSE '[]'::jsonb END,
           500, 100, 'gpt-oss-20b', 800, 300
      FROM generate_series(1, 100000) g`);
  await m.query(`
    INSERT INTO admin.audit (actor_account_id, action, object_type, object_id, result, occurred_at)
    SELECT NULL, 'documento.editar_metadata', 'documento', g::text, 'ok', now() - (g % 200 || ' days')::interval
      FROM generate_series(1, 10000) g`);
  await m.query("ANALYZE");
  const r = await fetch(`${app.base}/session`, { method: "POST", headers: { "content-type": "application/json", origin: "https://panel.prueba.gov.co", "x-forwarded-for": "10.0.0.9" },
    body: JSON.stringify({ email: "rendimiento@prueba.gov.co", password: PASSWORD }) });
  const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  return { base: app.base, cookie, cerrar: () => app.close() };
}

const manifestoPath = arg("--manifest");
if (!manifestoPath) { console.error("Falta --manifest <archivo.json> (objetivo autorizado)."); process.exit(1); }
const manifiesto = JSON.parse(await fs.readFile(manifestoPath, "utf8")) as Manifiesto;
const muestras = manifiesto.muestras ?? 20;
const dia = arg("--dia") ?? "1";
const salida = arg("--out") ?? path.join("..", "specs", "007-administracion-c3-c4", "evidencias", "performance");

let base: string; let cookie: string; let cerrar: () => Promise<void> = async () => {};
if (manifiesto.entorno === "aislado-local") {
  const s = await sembrarLocal();
  ({ base, cookie, cerrar } = s);
} else if (manifiesto.entorno === "c6") {
  const email = process.env[manifiesto.emailEnv ?? ""]; const password = process.env[manifiesto.passwordEnv ?? ""];
  if (!manifiesto.baseUrl || !email || !password) { console.error("El manifiesto c6 requiere baseUrl y las variables de entorno de credenciales."); process.exit(1); }
  base = manifiesto.baseUrl;
  const login = await fetch(`${base}/session`, { method: "POST", headers: { "content-type": "application/json", origin: new URL(base).origin }, body: JSON.stringify({ email, password }) });
  if (!login.ok) { console.error(`No se pudo iniciar sesión (${login.status}).`); process.exit(1); }
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
} else { console.error("entorno inválido en el manifiesto."); process.exit(1); }

try {
  const volumen = await volumenes(base, cookie);
  const faltas = volumenCumple(volumen);
  const pantallas = await medir(base, cookie, muestras);
  const informe = {
    requisito: "RNF-C3-AD-08", entorno: manifiesto.entorno, release: manifiesto.release ?? null, fechaBogota: fechaBogota(), dia,
    acreditaAceptacion: manifiesto.entorno === "c6" && faltas.length === 0, volumen, volumenFaltante: faltas,
    muestrasPorPantalla: muestras, umbralMs: 3000, pantallas, cumpleTodas: pantallas.every(p => p.cumple) && faltas.length === 0,
    nota: manifiesto.entorno === "c6"
      ? "La aceptación requiere dos fechas distintas en Bogotá y la revisión del informe (T093)."
      : "Medición CONTROLADA sobre datos sintéticos aislados: no acredita el requisito del cliente.",
  };
  await fs.mkdir(salida, { recursive: true });
  const archivo = path.join(salida, `${manifiesto.entorno}-${informe.fechaBogota}-dia${dia}.json`);
  await fs.writeFile(archivo, JSON.stringify(informe, null, 2));
  console.log(JSON.stringify({ archivo, cumpleTodas: informe.cumpleTodas, volumenFaltante: faltas, pantallas: pantallas.map(p => `${p.pantalla}: p95=${Math.round(p.p95Ms)}ms errores=${p.errores}`) }, null, 2));
  process.exitCode = informe.cumpleTodas ? 0 : 2;
} finally {
  await cerrar();
}
