/**
 * Reglas de alcance y de dirección responsable (T028; RF-C3-IV-01, IV-11; R9/R11).
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { Enlace, MetadatosGmas } from "../src/kb/runReport.js";
import {
  claveDe, construirContexto, direccionPara, esDelAlcance, procedimientosOrigenPara, tipoPara,
} from "../src/kb/scope.js";

const G = "https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=";
const A = "https://ambientometroenvigado.com";

function gmas(codigo: string, id: string, vinculados: Array<[string, string, string]> = []): MetadatosGmas {
  return {
    id, codigo, nombre: `Documento ${codigo}`, version: "01", fechaActualizacion: "2024-01-01", estado: "Vigente",
    dependencia: null, descarga: null,
    vinculados: vinculados.map(([c, i, grupo]) => ({ codigo: c, nombre: c, id: i, url: G + i, grupo })),
  };
}

function enlace(extra: Partial<Enlace>): Enlace {
  return {
    url: "https://x", fuente: "gmas2_envigado", fechaHora: new Date(), rol: "vinculado", padre: null, titulo: null,
    estadoDetectado: "vigente", resultado: "nuevo", error: null, hashContenido: "a".repeat(64),
    archivo: null, archivoOriginal: null, hashOriginal: null, gmas: null, ...extra,
  };
}

const gtp004 = enlace({ url: G + "0000010207", rol: "procedimiento",
  gmas: gmas("GT-P-004", "0000010207", [["GT-F-011", "0000013830", "Registros"], ["MG-F-051", "0000012522", "Registros"], ["GT-P-099", "0000099999", "Documentos Referencia"]]) });
const gtp021 = enlace({ url: G + "0000010445", rol: "procedimiento",
  gmas: gmas("GT-P-021", "0000010445", [["MG-F-051", "0000012522", "Registros"], ["GT-N-218", "0000001203", "Normatividad"]]) });
const gtf011 = enlace({ url: G + "0000013830", padre: gtp004.url, gmas: gmas("GT-F-011", "0000013830") });
const mgf051 = enlace({ url: G + "0000012522", padre: gtp004.url, gmas: gmas("MG-F-051", "0000012522") });
const gtn218 = enlace({ url: G + "0000001203", padre: gtp021.url, gmas: gmas("GT-N-218", "0000001203") });
const gtp099 = enlace({ url: G + "0000099999", padre: gtp004.url, gmas: gmas("GT-P-099", "0000099999") });
const mgfSuelto = enlace({ url: G + "0000077777", padre: gtp004.url, gmas: gmas("MG-F-777", "0000077777") });
const pagina = enlace({ url: `${A}/calidad-del-aire-indoor/`, fuente: "ambientometro", rol: "pagina", estadoDetectado: "no_aplica" });
const pdf = enlace({ url: `${A}/wp-content/uploads/boletin.pdf`, fuente: "ambientometro", rol: "documento",
  padre: `${A}/docs/boletines-2025/calidad-de-aire/abril/`, estadoDetectado: "no_aplica" });
const general = enlace({ url: `${A}/proyectos/`, fuente: "ambientometro", rol: "pagina", estadoDetectado: "no_aplica" });
const ajena = enlace({ url: "https://www.minambiente.gov.co/x/", fuente: "ambientometro", rol: "pagina", estadoDetectado: "no_aplica" });

const ctx = construirContexto([gtp004, gtp021, gtf011, mgf051, gtn218, gtp099, mgfSuelto, pagina, pdf, general, ajena]);

test("cada GT-P recibe su dirección del mapa", () => {
  assert.equal(direccionPara(gtp004, ctx), "gestion_ambiental");
  assert.equal(direccionPara(gtp021, ctx), "bienestar_animal");
});

test("un vinculado hereda la dirección de su GT-P", () => {
  assert.equal(direccionPara(gtf011, ctx), "gestion_ambiental");
  assert.equal(direccionPara(gtn218, ctx), "bienestar_animal");
});

test("con dos orígenes de direcciones distintas gana el primero por código y se listan ambos", () => {
  assert.deepEqual(procedimientosOrigenPara(mgf051, ctx), ["GT-P-004", "GT-P-021"]);
  assert.equal(direccionPara(mgf051, ctx), "gestion_ambiental");
});

test("páginas por prefijo más largo, PDF por su página padre y general por defecto", () => {
  assert.equal(direccionPara(pagina, ctx), "gestion_ambiental");
  assert.equal(direccionPara(pdf, ctx), "gestion_ambiental");
  assert.equal(direccionPara(general, ctx), "secretaria_general");
});

test("el contenido del Observatorio lleva como origen el nombre de su fuente", () => {
  assert.deepEqual(procedimientosOrigenPara(pagina, ctx), ["Ambientómetro"]);
  assert.deepEqual(procedimientosOrigenPara(pdf, ctx), ["Ambientómetro"]);
});

test("alcance: GT-P semilla, vinculados F/N/MG; fuera: otros GT-P, MG no citados y hosts ajenos", () => {
  for (const e of [gtp004, gtp021, gtf011, mgf051, gtn218, pagina, pdf, general]) {
    assert.equal(esDelAlcance(e, ctx).ok, true, e.url);
  }
  assert.equal(esDelAlcance(gtp099, ctx).ok, false, "un GT-P fuera de los 6 no entra aunque esté vinculado");
  assert.equal(esDelAlcance(mgfSuelto, ctx).ok, false, "un MG que ningún GT-P cita no entra");
  assert.equal(esDelAlcance(ajena, ctx).ok, false, "host fuera de la lista permitida");
});

test("tipo y clave: código para GMAS2, URL normalizada para el resto", () => {
  assert.equal(tipoPara(gtp004), "procedimiento");
  assert.equal(tipoPara(gtf011), "formato");
  assert.equal(tipoPara(gtn218), "norma");
  assert.equal(tipoPara(pagina), "pagina");
  assert.equal(tipoPara(pdf), "documento");
  assert.equal(claveDe(gtf011), "GT-F-011");
  assert.equal(claveDe(pagina), `${A}/calidad-del-aire-indoor`);
});
