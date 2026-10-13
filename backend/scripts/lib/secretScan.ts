/**
 * Escaneo de credenciales en el repositorio, la configuración y el paquete del frontend
 * (RNF-C3-IN-07/10). Devuelve solo CONTEOS y RUTAS: nunca el valor coincidente.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const PATRONES: Array<{ nombre: string; patron: RegExp }> = [
  { nombre: "AWS access key id", patron: /AKIA[0-9A-Z]{16}/ },
  { nombre: "AWS temporary key id", patron: /ASIA[0-9A-Z]{16}/ },
  { nombre: "clave privada PEM", patron: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { nombre: "bearer key de Bedrock", patron: /ABSK[A-Za-z0-9+/=]{24,}/ },
  { nombre: "aws_secret_access_key asignada", patron: /aws_secret_access_key\s*=\s*\S{20,}/i },
];

const IGNORAR = new Set(["node_modules", ".git", ".next", "test", "test-results", "playwright-report", ".cache", "dist", "var"]);
const EXTENSIONES = /\.(ts|tsx|js|mjs|json|ya?ml|conf|env|example|md|sql|html|css|sh|txt)$|Dockerfile$|Makefile$/;

export type ScanResult = { revisados: number; hallazgos: Array<{ ruta: string; regla: string }> };

export function scanSecrets(raiz: string, destinos: string[]): ScanResult {
  const out: ScanResult = { revisados: 0, hallazgos: [] };
  const revisaArchivo = (ruta: string): void => {
    out.revisados++;
    const contenido = readFileSync(ruta, "utf8");
    for (const { nombre, patron } of PATRONES) if (patron.test(contenido)) out.hallazgos.push({ ruta: ruta.replace(raiz, ""), regla: nombre });
  };
  const recorre = (dir: string, prof: number): void => {
    if (prof > 8) return;
    for (const nombre of readdirSync(dir)) {
      if (IGNORAR.has(nombre)) continue;
      const ruta = join(dir, nombre);
      const st = statSync(ruta);
      if (st.isDirectory()) { recorre(ruta, prof + 1); continue; }
      if (st.size > 2_000_000 || !EXTENSIONES.test(nombre)) continue;
      revisaArchivo(ruta);
    }
  };
  for (const destino of destinos) {
    const ruta = join(raiz, destino);
    try { statSync(ruta).isDirectory() ? recorre(ruta, 0) : revisaArchivo(ruta); } catch { /* no existe en este entorno */ }
  }
  return out;
}
