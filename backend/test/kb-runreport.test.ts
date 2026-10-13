/**
 * Validación del informe de corrida (T014, contracts/run-report.md).
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { esInformeListo, InformeInvalido, leerInforme, validarInforme } from "../src/kb/runReport.js";

const valido = () => ({
  schema_version: 1,
  run_id: "3f6c1b5e-7a1d-4c3b-9a55-2f0e8c1d2b3a",
  programada: true,
  iniciada_en: "2026-10-11T02:00:00-05:00",
  terminada_en: "2026-10-11T02:41:10-05:00",
  fuentes: ["gmas2_envigado"],
  completa: true,
  enlaces: [{
    url: "https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=0000010207",
    fuente: "gmas2_envigado", fecha_hora: "2026-10-11T02:03:12-05:00", rol: "procedimiento",
    padre: null, estado_detectado: "vigente", resultado: "nuevo", error: null,
    hash_contenido: "a".repeat(64), archivo: "gmas2_envigado/x.md",
    gmas: {
      id: "0000010207", codigo: "gt-p-004", nombre: "Procedimiento", version: "06",
      fecha_actualizacion: "2022-09-12", estado: "Vigente", dependencia: "SECRETARÍA",
      vinculados: [{ codigo: "GT-F-011", nombre: "Trámites", id: "0000013830", url: "https://gmas2.envigado.gov.co/x", grupo: "Registros" }],
    },
  }],
});

test("un informe válido se normaliza a tipos estrictos", () => {
  const informe = validarInforme(valido());
  assert.equal(informe.enlaces.length, 1);
  assert.equal(informe.enlaces[0].gmas?.codigo, "GT-P-004", "códigos en mayúsculas");
  assert.ok(informe.enlaces[0].fechaHora instanceof Date);
  assert.equal(informe.enlaces[0].gmas?.vinculados[0].grupo, "Registros");
});

test("se rechaza un informe sin run_id o con un resultado desconocido", () => {
  const sinId = valido(); delete (sinId as Record<string, unknown>).run_id;
  assert.throws(() => validarInforme(sinId), InformeInvalido);
  const malResultado = valido(); malResultado.enlaces[0].resultado = "quizas";
  assert.throws(() => validarInforme(malResultado), /resultado desconocido/);
  const version = { ...valido(), schema_version: 2 };
  assert.throws(() => validarInforme(version), /schema_version/);
});

test("un error nunca trae archivo ni hash (regla 1)", () => {
  const informe = valido();
  Object.assign(informe.enlaces[0], { resultado: "error", error: { tipo: "http", codigo_http: 503, detalle: "x" } });
  const enlace = validarInforme(informe).enlaces[0];
  assert.equal(enlace.archivo, null);
  assert.equal(enlace.hashContenido, null);
  assert.equal(enlace.error?.codigoHttp, 503);
});

test("los .tmp se ignoran: son informes a medio escribir", async () => {
  assert.equal(esInformeListo("abc.json"), true);
  assert.equal(esInformeListo("abc.json.tmp"), false);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kb-informe-"));
  try {
    const ruta = path.join(dir, "x.json.tmp");
    await fs.writeFile(ruta, JSON.stringify(valido()));
    await assert.rejects(leerInforme(ruta), InformeInvalido);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
