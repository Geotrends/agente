/**
 * Encabezados de fichas y páginas (T042; RF-C3-IV-05, IV-06, SC-003, SC-013).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { stripFrontmatter } from "../src/services/chunking.js";
import { encabezadoPagina, fichaProcedimiento, leerEncabezado } from "../src/kb/fichas.js";

const G = "https://gmas2.envigado.gov.co/gmas/VisualizacionDocumento.public?documento=";
const vinculados = [
  ["MG-P-003", "Documentos Referencia"], ["MG-F-002", "Documentos Transversales"], ["MG-F-051", "Registros"],
  ["GT-F-011", "Registros"], ["GT-F-012", "Registros"], ["GT-N-218", "Normatividad"], ["CS-N-012", "Normatividad"],
].map(([codigo, grupo], i) => ({ codigo, grupo, nombre: codigo, id: String(i), url: G + i }));

const base = {
  codigo: "GT-P-004", nombre: "Procedimiento permisos y autorizaciones ambientales", direccion: "gestion_ambiental" as const,
  estado: "Vigente", urlOrigen: G + "0000010207", version: "06", fechaActualizacion: "2022-09-12",
  fechaAcceso: new Date("2026-10-11T07:03:12Z"),
};

test("la ficha de un procedimiento tiene exactamente los 10 campos, en orden", () => {
  const md = fichaProcedimiento({ ...base, vinculados }, "Cuerpo del procedimiento.");
  const campos = leerEncabezado(md);
  assert.deepEqual(Object.keys(campos), [
    "codigo", "nombre", "direccion_responsable", "estado", "url_origen", "version",
    "fecha_actualizacion", "fecha_acceso", "formatos_vinculados", "normas_vinculadas",
  ]);
  assert.equal(campos.direccion_responsable, "Gestión Ambiental");
  assert.deepEqual(campos.formatos_vinculados, ["GT-F-011", "GT-F-012", "MG-F-002", "MG-F-051"]);
  assert.deepEqual(campos.normas_vinculadas, ["CS-N-012", "GT-N-218"]);
  assert.equal(stripFrontmatter(md).body.trim(), "Cuerpo del procedimiento.");
});

test("una lista vacía se escribe [] y nunca se omite", () => {
  const md = fichaProcedimiento({ ...base, vinculados: [] }, "x");
  assert.match(md, /^formatos_vinculados: \[\]$/m);
  assert.match(md, /^normas_vinculadas: \[\]$/m);
});

test("la página lleva URL, fecha de acceso y la misma huella de su versión", () => {
  const hash = "3f1c".padEnd(64, "a");
  const a = leerEncabezado(encabezadoPagina({ urlOrigen: "https://ambientometroenvigado.com/calidad-del-aire/", fechaAcceso: new Date("2026-10-01T00:00:00Z"), hashContenido: hash, titulo: "Calidad del aire" }, "x"));
  const b = leerEncabezado(encabezadoPagina({ urlOrigen: "https://ambientometroenvigado.com/calidad-del-aire/", fechaAcceso: new Date("2026-10-08T00:00:00Z"), hashContenido: hash, titulo: "Calidad del aire" }, "x"));
  assert.deepEqual(Object.keys(a).slice(0, 3), ["url_origen", "fecha_acceso", "hash_contenido"]);
  assert.equal(a.hash_contenido, hash);
  assert.equal(a.hash_contenido, b.hash_contenido, "cambiar la fecha de acceso no cambia la huella");
  assert.notEqual(a.fecha_acceso, b.fecha_acceso);
});
