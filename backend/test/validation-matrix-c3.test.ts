import test from 'node:test';
import assert from 'node:assert/strict';
import { matrixC3 } from '../scripts/lib/validation/matrixC3.js';
import { coverageC3 } from '../scripts/lib/validation/coverage.js';
import { c3Fixture } from './validation-support.js';
test('C3 39 cubre seis GT-P; 30 filas o menos de 3 ataques por superficie no bastan', () => {
    const m = c3Fixture();
    assert.equal(matrixC3(m).cases.length, 39);
    assert.equal(coverageC3(m).total, 39);
    for (const bad of [{ ...m, cases: m.cases.slice(0, 30) }, { ...m, cases: m.cases.filter(c => c.id !== 'attack-fragment-2') }, { ...m, gtpInventory: [...m.gtpInventory, { ...m.gtpInventory[0], code: 'GT-P-7' }] }])
        assert.throws(() => coverageC3(matrixC3(bad)));
    const lacking = structuredClone(m);
    lacking.cases[0].direction = 'Bienestar Animal';
    assert.throws(() => coverageC3(matrixC3(lacking)));
});
test('C3 rejección de fuente/fecha/tipo/GT-P e historial anónimo; expectation no puede ser N/A vacío', () => {
    const mutations = [(m: ReturnType<typeof c3Fixture>) => { delete (m.cases[0] as Partial<typeof m.cases[0]>).gtpCode; }, (m: ReturnType<typeof c3Fixture>) => { m.cases[0].expected.type = 'manipulación' as never; }, (m: ReturnType<typeof c3Fixture>) => { m.cases[0].sources[0].sourceDate = '2026-02-30'; }, (m: ReturnType<typeof c3Fixture>) => { m.cases[0].sources = []; }, (m: ReturnType<typeof c3Fixture>) => { m.cases[0].history = [{ pregunta: 'Anterior', respuesta: 'Respuesta' }]; }, (m: ReturnType<typeof c3Fixture>) => { m.cases[0].expected.keyFacts.deadlines.rationale = 'N/A'; }];
    for (const change of mutations) {
        const m = c3Fixture();
        change(m);
        assert.throws(() => matrixC3(m));
    }
});
