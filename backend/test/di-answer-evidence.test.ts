import test from "node:test";
import assert from "node:assert/strict";
import { buildSourceCatalog, formatContext, requireCitableSources, SourceDataError } from "../src/chat/sources.js";
import { parseDeclaration, selectUsedSources } from "../src/chat/sourceSelection.js";
import { composeAnswer } from "../src/chat/composeAnswer.js";
import { decidirAbstencion, respuestaAusencia } from "../src/chat/answerPolicy.js";
import { CONTACTOS, hit } from "./di-support.js";

test("catálogo: alias opacos por documento, https y fecha real; sin fecha o sin https es error de datos", () => {
  const { entries, invalid } = buildSourceCatalog([
    hit(1), hit(1, { snippet: "otro fragmento" }), hit(2, { fechaActualizacion: undefined, fechaAcceso: "2026-10-01T10:00:00Z" }),
    hit(3, { fechaActualizacion: undefined }), hit(4, { sourceUrl: "http://inseguro.example/x", sourcePageUrl: undefined }),
  ]);
  assert.deepEqual(entries.map(e => e.alias), ["D1", "D2"]);
  assert.equal(entries[0].hits.length, 2);
  assert.equal(entries[0].fechaTipo, "actualizado");
  assert.equal(entries[1].fechaTipo, "consultado");
  assert.equal(entries[1].fuente.fecha, "2026-10-01");
  assert.equal(invalid.length, 2);
  assert.ok(!formatContext(entries).includes("prueba.gov.co/doc"), "el modelo no ve rutas internas");
  assert.throws(() => requireCitableSources([hit(3, { fechaActualizacion: undefined })]), SourceDataError);
  assert.deepEqual(requireCitableSources([]), []);
});

test("10 respuestas, 3 con fuente sobrante: el sobrante nunca llega a la cita final", () => {
  for (let i = 0; i < 10; i++) {
    const sobrante = i < 3;
    const { entries } = buildSourceCatalog([hit(1), hit(2), hit(3)]);
    const raw = `Para el trámite presente la solicitud [D1] y adjunte el formato [D2].\n<!--FUENTES: D1|D2${sobrante ? "|D3" : ""}-->`;
    const sel = selectUsedSources(parseDeclaration(raw), entries, { requireSource: true });
    assert.ok(sel.ok);
    assert.deepEqual(sel.used.map(e => e.alias), ["D1", "D2"]);
    const out = composeAnswer({ body: parseDeclaration(raw).body, used: sel.used, contactos: CONTACTOS, requiereLeyenda: false, cerrarConCanales: false });
    assert.deepEqual(out.fuentes.map(f => f.id), ["doc-1", "doc-2"]);
    assert.ok(!out.respuesta.includes("Documento 3"));
  }
});

test("fuentes ajenas, marcador inválido y respuesta factual sin fuente", () => {
  const { entries } = buildSourceCatalog([hit(1), hit(2)]);
  // Alias ajeno declarado: se descarta.
  const ajeno = selectUsedSources(parseDeclaration("Texto [D1].\n<!--FUENTES: D1|D9-->"), entries, { requireSource: true });
  assert.ok(ajeno.ok && ajeno.used.length === 1);
  // Marcador inválido y cuerpo sin referencias: no se infiere ninguna fuente → fallo seguro.
  const invalido = selectUsedSources(parseDeclaration("Texto sin referencias.\n<!--FUENTES: ruta/secreta.pdf-->"), entries, { requireSource: true });
  assert.deepEqual(invalido, { ok: false, reason: "sin_fuente_valida" });
  // Marcador ausente pero cuerpo con referencias verificables: sirven.
  const sinMarcador = selectUsedSources(parseDeclaration("Texto [D2]."), entries, { requireSource: true });
  assert.ok(sinMarcador.ok && sinMarcador.used[0].alias === "D2");
  // Marcador vacío en una respuesta factual: fallo; en un saludo (requireSource false) no.
  assert.equal(selectUsedSources(parseDeclaration("Hola.\n<!--FUENTES:-->"), entries, { requireSource: true }).ok, false);
  const saludo = selectUsedSources(parseDeclaration("Hola.\n<!--FUENTES:-->"), entries, { requireSource: false });
  assert.ok(saludo.ok && saludo.used.length === 0);
  // Referencia a un alias inexistente en el cuerpo se retira del texto visible.
  const out = composeAnswer({ body: "Dato [D1] y dato [D7].", used: entries.slice(0, 1), contactos: CONTACTOS, requiereLeyenda: false, cerrarConCanales: false });
  assert.ok(!/\[D\d+\]/.test(out.respuesta));
});

test("sin citas dentro del texto ni marcadores técnicos; las fuentes viajan aparte", () => {
  const { entries } = buildSourceCatalog([hit(1), hit(2, { fechaActualizacion: undefined, fechaAcceso: "2026-10-01T00:00:00Z" })]);
  const out = composeAnswer({ body: "Requisito A [D1]. Requisito B [D2].<!--oculto-->", used: entries, contactos: CONTACTOS, requiereLeyenda: false, cerrarConCanales: false });
  assert.ok(!/según|actualizado el|consultado el|Fuentes:|\[D\d/.test(out.respuesta));
  assert.deepEqual(out.fuentes.map(f => f.fecha), ["2026-03-15", "2026-10-01"], "fecha y enlace siguen en las fuentes");
  assert.ok(!out.respuesta.includes("<!--"));
  assert.equal(out.fuentes.length, 2);
});

test("ausencia: texto fijo + canal vigente, sin citas; la búsqueda fallida jamás es ausencia", () => {
  for (let i = 0; i < 5; i++) {
    const r = decidirAbstencion({ exito: true, fragmentos: 0 }, CONTACTOS);
    assert.ok(r);
    assert.ok(r.respuesta.startsWith("No encontré información validada…"));
    assert.ok(r.respuesta.includes(CONTACTOS.recepcion.pqrsd));
    assert.deepEqual(r.fuentes, []);
    assert.ok(!/\bsegún\b|actualizado el|\[D\d/.test(r.respuesta));
  }
  for (let i = 0; i < 5; i++) assert.equal(decidirAbstencion({ exito: true, fragmentos: 3 }, CONTACTOS), null);
  assert.throws(() => decidirAbstencion({ exito: false }, CONTACTOS), /busqueda_fallida/);
  assert.equal(respuestaAusencia({ ...CONTACTOS, recepcion: { ...CONTACTOS.recepcion, whatsapp: "+57 311 555 0000" } }).respuesta.includes("311 555 0000"), true,
    "el canal sale del snapshot, no del código");
});
