/**
 * Formatos en blanco (T043; RF-C3-IV-10, research R12).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { formatoEnBlanco } from "../src/kb/blankForms.js";

const GT_F_011 = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "formatos", "gt-f-011.txt"), "utf8");

test("el GT-F-011 real, tal como se descarga de GMAS2, está en blanco", () => {
  const r = formatoEnBlanco(GT_F_011);
  assert.equal(r.enBlanco, true, r.motivos.join("; "));
});

test("una copia diligenciada se rechaza, con un motivo por campo", () => {
  for (const [campo, valor] of [
    ["NOMBRE:", "NOMBRE: Juan Pérez"],
    ["CÉDULA:", "CÉDULA: 1036123456"],
    ["TELÉFONO:", "TELÉFONO: 310 456 7890"],
    ["DIRECCIÓN:", "DIRECCIÓN: Calle 40 Sur # 25-10"],
  ]) {
    const r = formatoEnBlanco(GT_F_011.replace(campo, valor));
    assert.equal(r.enBlanco, false, `debió rechazar ${valor}`);
    assert.ok(r.motivos.length > 0);
  }
  assert.equal(formatoEnBlanco("NOMBRE: ________ BARRIO: La Magnolia").enBlanco, false,
    "el segundo campo de una misma línea también se revisa");
  const conCorreo = formatoEnBlanco(GT_F_011.replace("Autorizo dar respuesta al Correo Electrónico:",
    "Autorizo dar respuesta al Correo Electrónico: juan.perez@gmail.com"));
  assert.equal(conCorreo.enBlanco, false, "un correo personal es un dato diligenciado");
});

test("marcadores de espacio, etiquetas seguidas y correos institucionales no son diligenciamiento", () => {
  const texto = [
    "NOMBRE: ______________________",
    "CÉDULA: ..............",
    "TELÉFONO:            CELULAR: ____",
    "FIRMA DEL SOLICITANTE: -----------",
    "BARRIO:",
    "Mayores informes: ciudadano@envigado.gov.co, conmutador 3394000",
  ].join("\n");
  const r = formatoEnBlanco(texto);
  assert.equal(r.enBlanco, true, r.motivos.join("; "));
});
