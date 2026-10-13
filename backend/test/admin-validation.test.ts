import test from "node:test";
import assert from "node:assert/strict";
import {
  bogotaDate, bogotaDayStartUtc, hasDuplicateKeys, parseCivilDate, parseEmail, parsePrice, parsePublicUrl,
  parseRevision, requiredText, strictObject, ValidationError,
} from "../src/admin/validation.js";

const rejects = (fn: () => unknown, campo?: string) => {
  assert.throws(fn, (e: unknown) => e instanceof ValidationError && (campo === undefined || e.campo === campo));
};

test("strictObject rechaza claves desconocidas, arreglos y obligatorios ausentes", () => {
  assert.deepEqual(strictObject({ a: 1 }, ["a", "b"]), { a: 1 });
  rejects(() => strictObject({ a: 1, x: 2 }, ["a"]), "x");
  rejects(() => strictObject([], ["a"]), "cuerpo");
  rejects(() => strictObject(null, ["a"]), "cuerpo");
  rejects(() => strictObject({}, ["a"], ["a"]), "a");
});

test("claves JSON duplicadas se detectan solo dentro del mismo objeto", () => {
  assert.equal(hasDuplicateKeys('{"a":1,"a":2}'), true);
  assert.equal(hasDuplicateKeys('{"a":1,"b":{"a":2}}'), false);
  assert.equal(hasDuplicateKeys('{"a":[{"x":1},{"x":2}]}'), false);
  assert.equal(hasDuplicateKeys('{"a":"{\\"b\\":1,\\"b\\":2}"}'), false);
  assert.equal(hasDuplicateKeys('{"a":{"b":1,"b":2}}'), true);
});

test("revisión: cadena decimal positiva sin coerción desde número", () => {
  assert.equal(parseRevision("12"), "12");
  rejects(() => parseRevision(12));
  rejects(() => parseRevision("0"));
  rejects(() => parseRevision("012"));
  rejects(() => parseRevision("1e3"));
});

test("texto obligatorio recorta, rechaza vacío, control y exceso", () => {
  assert.equal(requiredText("  hola  ", "t"), "hola");
  rejects(() => requiredText("   ", "t"), "t");
  rejects(() => requiredText("a\u0007b", "t"));
  rejects(() => requiredText("x".repeat(11), "t", 10));
  assert.equal(requiredText("ñ".repeat(10), "t", 10).length, 10);
});

test("correo se normaliza; URL pública exige HTTPS sin credenciales", () => {
  assert.equal(parseEmail("  Ana@Correo.GOV.co "), "ana@correo.gov.co");
  rejects(() => parseEmail("sin-arroba"));
  assert.equal(parsePublicUrl("https://www.ejemplo.gov.co/x"), "https://www.ejemplo.gov.co/x");
  rejects(() => parsePublicUrl("http://ejemplo.gov.co"));
  rejects(() => parsePublicUrl("https://u:p@ejemplo.gov.co"));
  rejects(() => parsePublicUrl("https://localhost"));
});

test("precio: positivo, hasta 4 decimales, sin exponente ni exceso de dígitos", () => {
  for (const ok of ["0.07", "1", "12.3456", "0.0001"]) assert.equal(parsePrice(ok, "p"), ok);
  for (const bad of ["0", "0.0000", "-1", "1e2", "1.23456", ".5", "12345678901", "abc"]) rejects(() => parsePrice(bad, "p"));
  rejects(() => parsePrice(0.07, "p"));
});

test("fechas civiles y día de Bogotá (UTC−5)", () => {
  assert.equal(parseCivilDate("2026-02-28", "f"), "2026-02-28");
  rejects(() => parseCivilDate("2026-02-30", "f"));
  rejects(() => parseCivilDate("26-1-1", "f"));
  assert.equal(bogotaDate(new Date("2026-03-01T04:59:59Z")), "2026-02-28");
  assert.equal(bogotaDate(new Date("2026-03-01T05:00:00Z")), "2026-03-01");
  assert.equal(bogotaDayStartUtc("2026-03-01").toISOString(), "2026-03-01T05:00:00.000Z");
});
