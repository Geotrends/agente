import test from "node:test";
import assert from "node:assert/strict";
import { prioritizeByCategory, prioritizeProcedures } from "../src/chat/categoryPriority.js";
import { hit } from "./di-support.js";

const mezcla = () => [
  hit(1, { category: "Gestión Ambiental" }),
  hit(2, { category: "Ecosistemas" }),
  hit(3, { category: "Bienestar Animal" }),
  hit(4, { category: "Ecosistemas" }),
];
const ids = (hs: Array<{ documentId?: string }>) => hs.map(h => h.documentId);

test("la categoría elegida sube sus fragmentos y conserva el orden relativo", () => {
  assert.deepEqual(ids(prioritizeByCategory(mezcla(), "Ecosistemas")), ["doc-2", "doc-4", "doc-1", "doc-3"]);
});

test("nunca excluye: un documento de otra dirección sigue disponible (caso cruzado)", () => {
  for (const cat of ["Ecosistemas", "Bienestar Animal", "Gestión Ambiental"] as const) {
    const out = prioritizeByCategory(mezcla(), cat);
    assert.equal(out.length, 4);
    assert.deepEqual(ids(out).sort(), ["doc-1", "doc-2", "doc-3", "doc-4"]);
  }
});

test("sin categoría («No estoy seguro») o sin coincidencias el orden no cambia", () => {
  assert.deepEqual(ids(prioritizeByCategory(mezcla())), ["doc-1", "doc-2", "doc-3", "doc-4"]);
  const soloOtras = [hit(1, { category: "Gestión Ambiental" }), hit(2, { category: "Bienestar Animal" })];
  assert.deepEqual(ids(prioritizeByCategory(soloOtras, "Ecosistemas")), ["doc-1", "doc-2"]);
});

test("los procedimientos GT-P van antes que las páginas web y otros documentos, sin excluir nada y en orden estable", () => {
  const hs = [
    hit(1, { title: "Registro de animales de compañía", path: "web/rum.html" }),
    hit(2, { codigo: "GT-N-004", title: "Norma" }),
    hit(3, { codigo: "GT-P-011", title: "Registro Único Municipal" }),
    hit(4, { title: "Procedimiento GT-P-020 adopción" }),
  ];
  assert.deepEqual(ids(prioritizeProcedures(hs)), ["doc-3", "doc-4", "doc-1", "doc-2"]);
  const sinGtp = [hit(1, { title: "Web" }), hit(2, { title: "Otra" })];
  assert.deepEqual(ids(prioritizeProcedures(sinGtp)), ["doc-1", "doc-2"]);
});
