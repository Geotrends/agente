import test from 'node:test';
import assert from 'node:assert/strict';
import { matrixC4, coverageC4, type MatrixC4 } from '../scripts/lib/validation/matrixC4.js';
import { c3Fixture, c4Fixture } from './validation-support.js';
test('C4 cuenta22 filas, ocho flujos en ambos entornos y FAQ ligada a C3 respondido', () => {
    const m = matrixC4(c4Fixture(), c3Fixture(), false);
    assert.equal(coverageC4(m).total, 22);
    assert.equal(Math.ceil(m.cases.length * .9), 20);
    for (const change of [(x: MatrixC4) => { x.cases = x.cases.filter(c => c.flow !== 'rating'); }, (x: MatrixC4) => { x.cases.find(c => c.flow === 'faq')!.c3CaseId = 'missing'; }, (x: MatrixC4) => { (x.cases[0] as unknown as {
            runnerCase: string;
        }).runnerCase = 'eval'; }, (x: MatrixC4) => { x.cases.push(x.cases[0]); }, (x: MatrixC4) => { x.cases.filter(c => c.flow === 'functional-limit').forEach(c => c.variants = ['filing']); }, (x: MatrixC4) => { x.cases.find(c => c.flow === 'faq')!.direction = 'Bienestar Animal'; }]) {
        const bad = structuredClone(m);
        change(bad);
        assert.throws(() => coverageC4(matrixC4(bad, c3Fixture(), false)));
    }
});
