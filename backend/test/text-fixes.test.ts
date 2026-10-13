import { test } from "node:test";
import assert from "node:assert/strict";
import { fixCarnet } from "../src/chat/textFixes.js";

test("'carne' de documento pasa a 'carnet', con artículo masculino", () => {
  // Frases reales: la fuente GT-P-011 escribe "carne" sin tilde.
  assert.equal(fixCarnet("te entregará la “carne de la mascota”"), "te entregará el “carnet de la mascota”");
  assert.equal(fixCarnet("Copia del carne de vacunación."), "Copia del carnet de vacunación.");
  assert.equal(fixCarnet("Entrega del carne Municipal"), "Entrega del carnet Municipal");
  assert.equal(fixCarnet("presentar el carné escaneado"), "presentar el carnet escaneado");
  assert.equal(fixCarnet("Carne de vacunas al día"), "Carnet de vacunas al día");
  assert.equal(fixCarnet("una carne de identificación"), "un carnet de identificación");
});

test("'carne' como alimento no se toca", () => {
  for (const text of [
    "No le des carne cruda a tu mascota.",
    "la carne de res y la carne de cerdo",
    "El consumo de carne en la dieta del animal.",
    "carnetización",
  ]) assert.equal(fixCarnet(text), text);
});
