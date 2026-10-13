/**
 * Enlaces del scraper administrados desde el panel (SPEC007 T045/T046, RF-C3-AD-14..19).
 *
 * Dos validaciones INDEPENDIENTES (continuidad §2):
 *   · host: https y host de la lista cerrada de la configuración DESPLEGADA (nunca editable aquí);
 *   · corpus: qué contenido entra a la base lo decide el alcance de SPEC001 al procesar el informe.
 * La lista vigente vive en `kb.scraper_link`; cada cambio publica un snapshot atómico
 * (`<informes>/config/enlaces.json`) que el scraper Python lee en su siguiente corrida.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { cargarConfig, hostPermitido, type ConfigBase } from "./config.js";
import type { Pool, PoolClient } from "./db.js";

type Db = Pool | PoolClient;

export type FuenteScraper = "ambientometro" | "envigado_com" | "gmas2_envigado" | "observatorio_geotrends" | "concejo_envigado";

/** Fuente del scraper que recorre un host. */
export function fuentePorHost(host: string): FuenteScraper {
  const h = host.toLowerCase();
  if (h === "ambientometroenvigado.com") return "ambientometro";
  if (h === "observatorioenvigado.geotrends.co") return "observatorio_geotrends";
  if (h === "www.concejoenvigado.gov.co") return "concejo_envigado";
  if (h === "gmas2.envigado.gov.co") return "gmas2_envigado";
  return "envigado_com";
}

export type ResultadoValidacion = { ok: true; url: string; fuente: FuenteScraper } | { ok: false; motivo: string };

/** https + host permitido (RF-C3-AD-15). El motivo es legible para quien registra la propuesta. */
export function validarUrlEnlace(url: string, config: ConfigBase = cargarConfig()): ResultadoValidacion {
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, motivo: "La URL no es válida: incluya el protocolo https y un dominio." }; }
  if (u.protocol !== "https:") return { ok: false, motivo: "La URL debe usar el protocolo https." };
  if (u.username || u.password) return { ok: false, motivo: "La URL no puede incluir credenciales." };
  if (!u.hostname.includes(".")) return { ok: false, motivo: "La URL debe tener un dominio válido." };
  if (!hostPermitido(u.toString(), config)) return { ok: false, motivo: `El host ${u.hostname} no está en la lista de hosts permitidos.` };
  u.hash = "";
  return { ok: true, url: u.toString(), fuente: fuentePorHost(u.hostname) };
}

export type SnapshotEnlaces = {
  version: number;
  hash: string;
  links: Array<{ url: string; source: string; direction: string }>;
  removed: string[];
  createdAt: string;
  configHash: string;
};

export async function construirSnapshot(db: Db, config: ConfigBase = cargarConfig()): Promise<SnapshotEnlaces> {
  const { rows } = await db.query("SELECT url, source, direction::text AS direction, active FROM kb.scraper_link ORDER BY url");
  const version = Number((await db.query("SELECT revision FROM kb.scraper_link_list")).rows[0]?.revision ?? 1);
  const links = rows.filter(r => r.active).map(r => ({ url: r.url as string, source: r.source as string, direction: r.direction as string }));
  const removed = rows.filter(r => !r.active).map(r => r.url as string);
  const configHash = createHash("sha256").update(JSON.stringify(config.hostsPermitidos)).digest("hex");
  const hash = createHash("sha256").update(JSON.stringify({ links, removed, configHash })).digest("hex");
  return { version, hash, links, removed, createdAt: new Date().toISOString(), configHash };
}

/**
 * `<informes>/config/enlaces.json`: el volumen de informes es el único con escritura para el
 * kb-worker y el scraper; la subcarpeta evita que se lea como informe de corrida.
 */
export function rutaSnapshot(raiz = process.env.KB_RUNS_DIR ?? path.join(process.env.GEOTRENDS_DOCUMENTS_ROOT ?? "data", "runs")): string {
  return path.join(path.resolve(raiz), "config", "enlaces.json");
}

/** Publica el snapshot de forma atómica (archivo temporal + rename). No reescribe si no cambió. */
export async function publicarSnapshot(db: Db, raiz?: string): Promise<{ escrito: boolean; snapshot: SnapshotEnlaces }> {
  const snapshot = await construirSnapshot(db);
  const destino = rutaSnapshot(raiz);
  try {
    const actual = JSON.parse(await fs.readFile(destino, "utf8")) as SnapshotEnlaces;
    if (actual.hash === snapshot.hash && actual.version === snapshot.version) return { escrito: false, snapshot };
  } catch { /* sin snapshot previo */ }
  await fs.mkdir(path.dirname(destino), { recursive: true });
  const tmp = `${destino}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(snapshot), { mode: 0o640 });
  await fs.rename(tmp, destino);
  return { escrito: true, snapshot };
}

/** Siembra la lista con las semillas de la configuración desplegada (idempotente). */
export async function sembrarEnlaces(db: Db, config: ConfigBase = cargarConfig()): Promise<number> {
  const links = config.enlacesIniciales.map(e => ({ url: e.url, source: e.fuente, direction: e.direccion }));
  if (!links.length) return 0;
  const { rows } = await db.query("SELECT kb.sembrar_enlaces($1::jsonb) AS n", [JSON.stringify(links)]);
  return Number(rows[0].n);
}
