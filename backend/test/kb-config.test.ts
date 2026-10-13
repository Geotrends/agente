/**
 * Configuración versionada de la base de conocimiento (T010, research R11).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { cargarConfig, direccionPorUrl, hostPermitido, validarConfig } from "../src/kb/config.js";

test("la configuración del repositorio carga y trae los 6 GT-P del alcance", () => {
  const config = cargarConfig();
  assert.deepEqual(Object.keys(config.procedimientos).sort(),
    ["GT-P-004", "GT-P-011", "GT-P-020", "GT-P-021", "GT-P-027", "GT-P-029"]);
  assert.equal(config.procedimientos["GT-P-004"], "gestion_ambiental");
  assert.equal(config.procedimientos["GT-P-029"], "ecosistemas");
});

test("una configuración inválida enumera todos sus errores", () => {
  assert.throws(() => validarConfig({
    procedimientos: { "GT-P-004": "gestion ambiental" },
    hosts_permitidos: [{ host: "x.co", tipo: "comodin" }],
    secciones: [{ host: "x.co", prefijo: "sin-barra", direccion: "ecosistemas" }],
  }), (error: Error) =>
    /dirección inválida "gestion ambiental"/.test(error.message)
    && /tipo inválido "comodin"/.test(error.message)
    && /debe empezar por "\/"/.test(error.message));
});

test("hosts permitidos: dominio con subdominios, host exacto y solo https (RF-C3-AD-15)", () => {
  assert.ok(hostPermitido("https://gmas2.envigado.gov.co/gmas/x"));
  assert.ok(hostPermitido("https://envigado.gov.co/contactenos"));
  assert.ok(hostPermitido("https://ambientometroenvigado.com/calidad-del-aire/"));
  assert.equal(hostPermitido("http://ambientometroenvigado.com/"), false, "http no se admite");
  assert.equal(hostPermitido("https://www.ambientometroenvigado.com/"), false, "host exacto: www no casa");
  assert.equal(hostPermitido("https://concejoenvigado.gov.co/"), false, "solo www.concejoenvigado.gov.co");
  assert.equal(hostPermitido("https://envigado.gov.co.malicioso.com/"), false);
  assert.equal(hostPermitido("https://www.minambiente.gov.co/"), false);
});

test("dirección por sección: gana el prefijo más largo; sin coincidencia, general", () => {
  const base = "https://ambientometroenvigado.com";
  assert.equal(direccionPorUrl(`${base}/calidad-del-aire-indoor/`), "gestion_ambiental");
  assert.equal(direccionPorUrl(`${base}/campana-de-adopcion-animales-de-compania/`), "bienestar_animal");
  assert.equal(direccionPorUrl(`${base}/observatorio/indicadores-recurso-natural/indicadores-fauna/`), "ecosistemas");
  assert.equal(direccionPorUrl(`${base}/secreatria-de-medio-ambiente-y-desarrollo-rural/informacion-ambiental/bienestar-animal/`), "bienestar_animal");
  assert.equal(direccionPorUrl(`${base}/secreatria-de-medio-ambiente-y-desarrollo-rural/informacion-ambiental/`), "secretaria_general");
  assert.equal(direccionPorUrl(`${base}/docs/2022-2/ruido/abril/`), "gestion_ambiental");
  assert.equal(direccionPorUrl(`${base}/proyectos/`), "secretaria_general");
  assert.equal(direccionPorUrl("https://www.envigado.gov.co/contactenos"), "secretaria_general");
});
