/**
 * No degradación del Observatorio y del Geoportal (N313, RNF-C3-IN-13): 180 muestras.
 *
 *   npm run eval:di-host -- --observatorio-url=<https://…> --geoportal-url=<https://…> [--geoportal-method=GET|POST]
 *        [--geoportal-body='{"…"}'] --base-url=<https://host/api> --origin=<origen del ChatBot> --policy-version=<v>
 *        --reindex-cmd='<comando de reindexación completa de SPEC001>' --output=<dir> [--n=30] [--timeout-ms=120000]
 *
 * Condiciones: sin carga, reindexación completa (proceso real, con ventana de solapamiento) y una oleada
 * real de 25 consultas (15 autorizadas de 5 conversaciones + 10 anónimas). Si una ventana no alcanza para las
 * 30 muestras se abren ventanas equivalentes adicionales, identificadas como «extra»: NO sustituyen las
 * tres oleadas de N303. Cada destino se compara con su propia línea base; error, timeout o solapamiento
 * incompleto impiden aprobar. Imprime el informe sin cuerpos ni credenciales.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { ejecutarNoDegradacion, type CargaActiva, type DestinoSpec } from "./lib/hostRunner.js";
import { bogotaDay, runWaves } from "./lib/loadRunner.js";

const arg = (n: string) => process.argv.slice(2).find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const faltan = ["observatorio-url", "geoportal-url", "base-url", "origin", "reindex-cmd", "output"].filter(k => !arg(k));
if (faltan.length) { console.error(`Faltan: ${faltan.map(f => `--${f}`).join(", ")}`); process.exit(2); }

const destinos: DestinoSpec[] = [
  { id: "observatorio", url: arg("observatorio-url")!, method: "GET", criterio: { status: [200], minBytes: 500 } },
  { id: "geoportal", url: arg("geoportal-url")!, method: (arg("geoportal-method") as "GET" | "POST" | undefined) ?? "GET",
    ...(arg("geoportal-body") ? { body: arg("geoportal-body"), headers: { "Content-Type": "application/json" } } : {}),
    criterio: { status: [200], minBytes: 50 } },
];
const target = { baseUrl: arg("base-url")!.replace(/\/$/, ""), policyVersion: arg("policy-version") ?? process.env.CONSENT_POLICY_VERSION ?? "", origin: arg("origin") };

const iniciarReindexacion = (): CargaActiva => {
  const hijo = spawn("sh", ["-c", arg("reindex-cmd")!], { stdio: "ignore" });
  return { etiqueta: "reindexacion-completa", terminada: new Promise<void>(res => { hijo.on("exit", () => res()); hijo.on("error", () => res()); }) };
};
// Cada oleada (25 consultas) respeta la cuota real de 60/min: entre inicios de oleada pasan ≥ 25 s.
let ultimaOleada = 0;
const iniciarOleada = (): CargaActiva => {
  const espera = Math.max(0, ultimaOleada + 25_000 - Date.now());
  const terminada = (async () => {
    if (espera > 0) await new Promise(r => setTimeout(r, espera));
    ultimaOleada = Date.now();
    await runWaves(target, 1, 25, 0);
  })();
  return { etiqueta: "oleada-25-n313", terminada };
};

const inicio = new Date();
const r = await ejecutarNoDegradacion({
  destinos, iniciarReindexacion, iniciarOleada,
  n: Number(arg("n") ?? 30), timeoutMs: Number(arg("timeout-ms") ?? 120_000),
});
const informe = {
  fecha: inicio.toISOString(), fechaLocalBogota: bogotaDay(inicio), componente: "H/A/P (solo si destinos y servicio son los desplegados)",
  destinos: destinos.map(d => ({ id: d.id, method: d.method, host: new URL(d.url).host })),
  evaluacion: r.evaluacion, ventanas: r.ventanas.map(v => ({ ...v, finMs: Number.isFinite(v.finMs) ? v.finMs : null })),
  muestras: r.muestras.map(m => ({ destino: m.destino, condicion: m.condicion, indice: m.indice, inicioMs: m.inicioMs, finMs: m.finMs, ms: Math.round(m.ms), status: m.status, ok: m.ok, motivo: m.motivo, enCarga: m.enCarga })),
};
await fs.mkdir(path.resolve(arg("output")!), { recursive: true });
await fs.writeFile(path.join(path.resolve(arg("output")!), `host-${informe.fechaLocalBogota}-${inicio.toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify(informe, null, 2) + "\n");
console.log(JSON.stringify({ ...informe, muestras: `${informe.muestras.length} muestras (en el archivo)` }, null, 2));
process.exit(r.evaluacion.aprobado ? 0 : 1);
