import test from "node:test";
import assert from "node:assert/strict";
import { parseJson } from "../scripts/lib/validation/readJson.js";
import { object, text, instant, civilDate, person, sha, requirement, unique, enumeration, version } from "../scripts/lib/validation/types.js";
test("JSON estricto: duplicados incluso escapes/anidados; nunca evalúa código", () => {
    for (const raw of ['{"id":1,"id":2}', '{"id":1,"\\u0069d":2}', '{"a":{"x":1,"x":2}}', '{"x":NaN}', '{"x":1e999}', '\ufeff{}', '({x: process.exit(0)})', '{"__proto__":{}}', '[1,]'])
        assert.throws(() => parseJson(raw));
    assert.deepEqual(parseJson('{"x":[{"a":"texto \\\""},true,null]}'), { x: [{ a: 'texto "' }, true, null] });
});
test("Contratos comunes rechazan ambigüedad, placeholders y requisitos inventados", () => {
    for (const v of [null, undefined, '', '  ', 'TODO', 'N/A', 'pendiente'])
        assert.throws(() => text(v));
    assert.throws(() => object({ schemaVersion: 1, extra: true }, ['schemaVersion']));
    for (const v of [0, 2, "1", null])
        assert.throws(() => version(v));
    assert.throws(() => enumeration('unknown', ['pass', 'fail']));
    for (const v of ['2026-10-10T10:00:00', '2026-02-30T10:00:00Z', 'bad'])
        assert.throws(() => instant(v));
    assert.equal(instant('2026-10-10T10:00:00-05:00'), '2026-10-10T15:00:00.000Z');
    assert.throws(() => civilDate('2026-02-30'));
    assert.throws(() => person({ name: 'TODO', role: 'revisor' }));
    assert.throws(() => sha('abc'));
    assert.throws(() => requirement('RF-C3-VA-99'));
    assert.equal(requirement('RF-C3-VA-01'), 'RF-C3-VA-01');
    assert.throws(() => unique([{ id: 'a' }, { id: 'a' }], x => x.id));
});
