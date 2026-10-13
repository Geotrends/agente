/** `npx tsx scripts/scan-secrets.ts [raiz]`: imprime conteos y rutas, nunca valores; código 1 si hay hallazgos. */
import { fileURLToPath } from "node:url";
import { scanSecrets } from "./lib/secretScan.js";

const raiz = process.argv[2] ?? fileURLToPath(new URL("../..", import.meta.url));
const destinos = ["backend/src", "backend/migrations", "backend/config", "backend/scripts", "frontend/app", "frontend/chat", "frontend/shared",
  "frontend/widget", "frontend/scripts", "frontend/public", "frontend/out", "docker-compose.yml", ".env.example",
  "backend/Dockerfile", "frontend/Dockerfile", "frontend/nginx.conf", ".github"];
const r = scanSecrets(raiz, destinos);
console.log(`archivos revisados: ${r.revisados}`);
console.log(`hallazgos: ${r.hallazgos.length}`);
for (const h of r.hallazgos) console.log(`  ${h.ruta}: ${h.regla}`);
process.exit(r.hallazgos.length ? 1 : 0);
