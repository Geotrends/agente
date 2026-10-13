import test from "node:test";
import assert from "node:assert/strict";
import { composeWithinLimit, isCompleteUnit, OutputLimitError, splitUnits } from "../src/chat/outputLimit.js";
import { countTokens } from "../src/chat/outputTokenizer.js";
import { buildSourceCatalog } from "../src/chat/sources.js";
import { AVISO_ABREVIADA } from "../src/prompts/institutionalTexts.js";
import { CONTACTOS, hit } from "./di-support.js";

const { entries } = buildSourceCatalog([hit(1), hit(2), hit(3)]);

const oracion = (i: number, ref: string) => `El trámite número ${i} exige presentar la solicitud en la ventanilla correspondiente y esperar la validación ${ref}.`;

function cuerpoLargo(unidades: number): string {
  const partes: string[] = [];
  let parrafo: string[] = [];
  const cerrar = () => { if (parrafo.length) partes.push(parrafo.join(" ")); parrafo = []; };
  for (let i = 0; i < unidades; i++) {
    const ref = i < 10 ? "[D1]" : i < 200 ? "[D2]" : "[D3]";
    parrafo.push(oracion(i, ref));
    if (i % 25 === 24) { cerrar(); partes.push("| Documento | Plazo |\n|---|---|\n| GT-P-020 | 15 días |\n| GT-F-058 | 5 días |"); }
    if (i % 40 === 39) { cerrar(); partes.push(`- Consulte [el sitio](https://www.envigado.gov.co/tema/tramites?i=${i}) para ampliar`); }
  }
  cerrar();
  return partes.join("\n\n");
}

const base = { used: entries, contactos: CONTACTOS, requiereLeyenda: true, cerrarConCanales: true };

test("3 normales: no llevan aviso y caben en el tope", () => {
  for (let i = 0; i < 3; i++) {
    const r = composeWithinLimit({ ...base, body: `${oracion(i, "[D1]")} Más detalle ${i}. [D2]`, stopReason: "end_turn" });
    assert.equal(r.abreviada, false);
    assert.ok(!r.respuesta.includes(AVISO_ABREVIADA));
    assert.ok(r.visibleTokens <= 2200 && r.visibleTokens === countTokens(r.respuesta));
  }
});

test("6 cortes por max_tokens (3 por modelo): última oración completa, cita con enlace y fecha, aviso exacto", () => {
  for (let i = 0; i < 6; i++) {
    const cortada = `${oracion(1, "[D1]")} ${oracion(2, "[D2]")} El tercer paso consiste en entregar el form`;
    const r = composeWithinLimit({ ...base, body: cortada, stopReason: "max_tokens" });
    assert.equal(r.abreviada, true);
    assert.ok(r.respuesta.includes(`${AVISO_ABREVIADA}.`));
    assert.ok(!r.respuesta.includes("entregar el form"), "se descarta la oración inconclusa");
    assert.match(r.respuesta, /\[Documento 2\]\(https:\/\/prueba\.gov\.co\/doc-2\.pdf\), actualizado el 2026-03-15/);
    assert.ok(r.respuesta.includes("no reemplaza asesoría técnica"), "la leyenda se conserva");
    assert.ok(r.respuesta.includes(CONTACTOS.recepcion.pqrsd), "el cierre se conserva");
  }
});

test("10 largas (5 por modelo): ≤2200 tokens contados, aviso, sin partir URL/tabla, fuentes sincronizadas", () => {
  for (let i = 0; i < 10; i++) {
    const r = composeWithinLimit({ ...base, body: cuerpoLargo(150 + i * 10), stopReason: "end_turn" });
    assert.equal(r.abreviada, true);
    assert.ok(countTokens(r.respuesta) <= 2200, `${countTokens(r.respuesta)} tokens`);
    assert.ok(r.respuesta.includes(AVISO_ABREVIADA));
    // Ninguna URL ni tabla cortada a la mitad.
    for (const url of r.respuesta.match(/https:\/\/[^\s)]+/g) ?? []) assert.ok(/^https:\/\/(www\.envigado\.gov\.co\/tema\/tramites\?i=\d+|prueba\.gov\.co\/[\w./-]+|pqrsd\.prueba\.gov\.co\/radicar)$/.test(url), url);
    const tablas = r.respuesta.split("| Documento | Plazo |").length - 1;
    assert.equal(r.respuesta.split("| GT-F-058 | 5 días |").length - 1, tablas, "cada tabla está completa");
    // Fuentes = documentos que siguen citados en el texto.
    for (const f of r.fuentes) assert.ok(r.respuesta.includes(f.enlace), `fuente ${f.id} sin cita visible`);
    assert.ok(!/\[D\d+\]/.test(r.respuesta));
  }
});

test("una fuente cuyo contenido se recortó ya no aparece (los sobrantes no reaparecen)", () => {
  const r = composeWithinLimit({ ...base, body: cuerpoLargo(400), stopReason: "end_turn" });
  assert.ok(!r.fuentes.some(f => f.id === "doc-3"), "D3 solo se citaba después del recorte");
  assert.ok(r.fuentes.some(f => f.id === "doc-1"));
});

test("si ni una unidad respaldada cabe, falla de forma segura", () => {
  assert.throws(() => composeWithinLimit({ ...base, body: oracion(1, "[D1]"), stopReason: "end_turn" }, countTokens, 30), OutputLimitError);
});

test("unidades: tabla indivisible, URL no se parte, incompleta se detecta", () => {
  const u = splitUnits("Texto uno. Texto dos con [enlace](https://a.co/x.y?z=1). Fin.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- ítem uno\n- ítem dos");
  assert.deepEqual(u.map(x => x.text), ["Texto uno.", "Texto dos con [enlace](https://a.co/x.y?z=1).", "Fin.", "| A | B |\n|---|---|\n| 1 | 2 |", "- ítem uno", "- ítem dos"]);
  assert.equal(isCompleteUnit("Termina bien."), true);
  assert.equal(isCompleteUnit("Termina a medias y"), false);
  assert.equal(isCompleteUnit("Cita al final [D1]."), true);
});
