/**
 * Esquema `kb` contra PostgreSQL real (T011, T012): migraciones idempotentes,
 * restricciones del data model y permisos mínimos del rol del chat.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import pg from "pg";
import { aplicarMigraciones } from "../../src/kb/db.js";
import { crearBaseDePrueba, type BaseDePrueba } from "./helpers.js";

let base: BaseDePrueba;
before(async () => { base = await crearBaseDePrueba(); });
after(async () => { await base?.borrar(); });

const elemento = (extra: Record<string, unknown> = {}) => ({
  clave: "GT-P-004", codigo: "GT-P-004", nombre: "Procedimiento", tipo: "procedimiento",
  direccion: "gestion_ambiental", url_origen: "https://gmas2.envigado.gov.co/x", estado: "pendiente_aprobacion",
  version_documento: "06", fecha_actualizacion: "2022-09-12", formato_original: "html",
  procedimientos_origen: ["GT-P-004"], fuente: "gmas2_envigado", ...extra,
});

async function insertar(valores: Record<string, unknown>): Promise<void> {
  const columnas = Object.keys(valores);
  await base.kb.query(
    `INSERT INTO kb.kb_elemento (${columnas.join(",")}) VALUES (${columnas.map((_, i) => `$${i + 1}`).join(",")})`,
    Object.values(valores),
  );
}

test("las migraciones son idempotentes", async () => {
  assert.deepEqual(await aplicarMigraciones(base.kb), []);
});

test("un elemento de GMAS2 exige código, versión y fecha; el Observatorio admite N/A (FR-003)", async () => {
  await assert.rejects(insertar(elemento({ clave: "GT-F-999", codigo: null })), /na_solo_en_observatorio/);
  await insertar(elemento({
    clave: "https://ambientometroenvigado.com/calidad-del-aire/", codigo: null, version_documento: null,
    fecha_actualizacion: null, tipo: "pagina", fuente: "ambientometro", url_origen: "https://ambientometroenvigado.com/calidad-del-aire/",
    procedimientos_origen: ["Ambientómetro"],
  }));
  const { rows } = await base.kb.query("SELECT codigo, version, fecha_actualizacion, procedimiento_origen, fecha_carga FROM kb.v_matriz");
  assert.deepEqual(
    { ...rows[0], fecha_carga: undefined },
    { codigo: "N/A", version: "N/A", fecha_actualizacion: "N/A", procedimiento_origen: "Ambientómetro", fecha_carga: undefined },
  );
  assert.match(rows[0].fecha_carga, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/, "la fecha de carga siempre se diligencia");
});

test("procedimiento de origen nunca vacío y URL solo https", async () => {
  await assert.rejects(insertar(elemento({ clave: "GT-P-011", procedimientos_origen: [] })), /procedimientos_origen/);
  await assert.rejects(insertar(elemento({ clave: "GT-P-020", url_origen: "http://gmas2.envigado.gov.co/x" })), /url_origen/);
});

test("solo puede haber una notificación sin revisar por tipo y objeto", async () => {
  const sql = "INSERT INTO kb.kb_notificacion (tipo, objeto, descripcion) VALUES ('verificacion_fallida', 'https://a', 'x')";
  await base.kb.query(sql);
  await assert.rejects(base.kb.query(sql), /kb_notificacion_agrupada/);
});

test("solo puede haber una indexación en curso", async () => {
  const sql = "INSERT INTO kb.kb_indexacion (tipo, coleccion, estado) VALUES ('completa', 'kb_chunks_x', 'en_curso')";
  await base.kb.query(sql);
  await assert.rejects(base.kb.query(sql), /kb_indexacion_una_en_curso/);
});

test("el rol del chat solo lee la vista de códigos publicados (principio VII)", async () => {
  const app = new pg.Client({ connectionString: base.appUrl });
  await app.connect();
  try {
    await app.query("SELECT * FROM kb.v_codigos_publicados");
    await assert.rejects(app.query("SELECT * FROM kb.kb_elemento"), /permission denied/);
    await assert.rejects(app.query("SELECT * FROM kb.v_matriz"), /permission denied/);
    await assert.rejects(app.query("INSERT INTO kb.kb_auditoria (actor, accion, objeto, resultado) VALUES ('x','x','x','x')"), /permission denied/);
  } finally {
    await app.end();
  }
});

test("SPEC008: columnas de objetivo/reintento, versión aplazada y FK de la publicada en RESTRICT", async () => {
  const { rows: cols } = await base.kb.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'kb' AND column_name IN ('target_version_id','cleanup_attempts','next_attempt_at','needs_attention','version_aplazada_id')`);
  assert.deepEqual(cols.map(c => `${c.table_name}.${c.column_name}`).sort(), [
    "document_operation.cleanup_attempts", "document_operation.needs_attention", "document_operation.next_attempt_at",
    "document_operation.target_version_id", "kb_elemento.version_aplazada_id",
  ]);
  const { rows: [fk] } = await base.kb.query(
    "SELECT confdeltype FROM pg_constraint WHERE conname = 'version_publicada_fk' AND conrelid = 'kb.kb_elemento'::regclass");
  assert.equal(fk.confdeltype, "r", "ON DELETE RESTRICT");
});
