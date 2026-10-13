/**
 * Revisión de seguridad de la base (T081; principios IV y VII, RF-C3-IV-10/11):
 * puertos cerrados, lectura mínima del rol del chat y descripciones sin rutas
 * ni datos personales.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import pg from "pg";
import { maskPersonalData } from "../../src/services/pii.js";
import { registrarAccion } from "../../src/kb/audit.js";
import { procesarInforme } from "../../src/kb/sync.js";
import { crearBaseDePrueba, type BaseDePrueba } from "./helpers.js";

let base: BaseDePrueba;
let datos: string;

before(async () => {
  base = await crearBaseDePrueba();
  datos = await fs.mkdtemp(path.join(os.tmpdir(), "kb-perm-"));
  process.env.GEOTRENDS_DOCUMENTS_ROOT = datos;
});

after(async () => {
  await base?.borrar();
  await fs.rm(datos, { recursive: true, force: true });
});

test("postgres y qdrant no publican puertos en docker-compose.yml", async () => {
  const compose = await fs.readFile(path.join(import.meta.dirname, "..", "..", "..", "docker-compose.yml"), "utf8");
  for (const servicio of ["postgres", "qdrant", "kb-worker"]) {
    const bloque = new RegExp(`^  ${servicio}:\\n([\\s\\S]*?)(?=^  \\S|^\\S)`, "m").exec(compose)?.[1];
    assert.ok(bloque, `no encontré el servicio ${servicio}`);
    assert.doesNotMatch(bloque, /^\s+ports:/m, `${servicio} no debe publicar puertos`);
  }
});

test("app_reader solo lee kb.v_codigos_publicados", async () => {
  const app = new pg.Client({ connectionString: base.appUrl });
  await app.connect();
  try {
    await app.query("SELECT codigo, url FROM kb.v_codigos_publicados");
    for (const consulta of [
      "SELECT * FROM kb.kb_elemento", "SELECT * FROM kb.v_matriz", "SELECT * FROM kb.kb_version",
      "SELECT * FROM kb.kb_notificacion", "SELECT * FROM kb.kb_auditoria", "SELECT * FROM kb.kb_procesamiento",
      "INSERT INTO kb.kb_purga (filas_por_tabla) VALUES ('{}')",
      "DELETE FROM kb.kb_elemento", "CREATE TABLE public.x (a int)",
    ]) {
      await assert.rejects(app.query(consulta), /permission denied/i, consulta);
    }
  } finally {
    await app.end();
  }
});

test("las descripciones de notificaciones, los detalles y la auditoría no llevan rutas ni datos personales", async () => {
  // Un archivo que no existe: el error del sistema operativo incluye la ruta absoluta.
  const informe = {
    schema_version: 1, run_id: randomUUID(), programada: true, completa: false,
    iniciada_en: new Date().toISOString(), terminada_en: new Date().toISOString(), fuentes: ["ambientometro"],
    enlaces: [{
      fuente: "ambientometro", fecha_hora: new Date().toISOString(), rol: "documento", padre: "https://ambientometroenvigado.com/docs/",
      titulo: "Boletín", estado_detectado: "no_aplica", resultado: "nuevo", error: null, hash_contenido: null, archivo: null,
      archivo_original: "ambientometro/documentos/pdf/no-existe.pdf", hash_original: "a".repeat(64), gmas: null,
      url: "https://ambientometroenvigado.com/boletin.pdf",
    }, {
      fuente: "ambientometro", fecha_hora: new Date().toISOString(), rol: "documento", padre: null, titulo: null,
      estado_detectado: "no_aplica", resultado: "error", hash_contenido: null, archivo: null, archivo_original: null, hash_original: null, gmas: null,
      url: "https://ambientometroenvigado.com/caido.pdf",
      error: { tipo: "inaccesible", detalle: "falló /app/data/ambientometro/x.pdf para juan.perez@gmail.com cel 3104567890" },
    }],
  };
  const ruta = path.join(datos, "runs", `${informe.run_id}.json`);
  await fs.mkdir(path.dirname(ruta), { recursive: true });
  await fs.writeFile(ruta, JSON.stringify(informe));
  await procesarInforme(base.kb, ruta);
  await registrarAccion(base.kb, "cli:prueba", "reconstruir_coleccion", "kb_chunks_x",
    "fallida: ENOENT /Users/alguien/data/x.pdf contacto maria@correo.com");

  const textos = [
    ...(await base.kb.query("SELECT descripcion AS t FROM kb.kb_notificacion")).rows,
    ...(await base.kb.query("SELECT detalle AS t FROM kb.kb_procesamiento WHERE detalle IS NOT NULL")).rows,
    ...(await base.kb.query("SELECT objeto || ' ' || resultado AS t FROM kb.kb_auditoria")).rows,
  ].map(r => String(r.t));
  assert.ok(textos.length >= 3, "hay filas que revisar");
  for (const t of textos) {
    assert.doesNotMatch(t, /(?:^|[\s"'(])\/(?:app|data|home|Users|tmp|var|opt|private)\//, `ruta absoluta en: ${t}`);
    assert.equal(maskPersonalData(t), t, `dato personal en: ${t}`);
  }
});
