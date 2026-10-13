import test from 'node:test';
import assert from 'node:assert/strict';
import { transitionFinding } from '../scripts/lib/validation/findingValidation.js';
import { validateFinding } from '../scripts/lib/validation/findings.js';
import { findingFixture } from './validation-support.js';
import { personFixture, refFixture } from './validation-support.js';
test('historia append-only, ajuste no cierra y validación necesita corridas completas posteriores por modelo', () => {
    let f = validateFinding(findingFixture());
    const event = (to: string, index: number) => ({ id: 'event-' + index, at: `2026-10-11T0${index}:00:00Z`, by: personFixture, from: f.status, to, description: 'Paso sintético verificable', evidenceRef: refFixture, adjustmentRef: refFixture });
    f = transitionFinding(f, 'En análisis', event('En análisis', 1));
    f = transitionFinding(f, 'En ajuste', event('En ajuste', 2));
    f = transitionFinding(f, 'Ajustada', event('Ajustada', 3));
    assert.equal(f.events.length, 4);
    assert.throws(() => transitionFinding(f, 'Cerrada', event('Cerrada', 4)));
    assert.throws(() => transitionFinding(f, 'Validada', event('Validada', 4)));
    const reopened = transitionFinding(f, 'En análisis', event('En análisis', 4));
    assert.equal(reopened.events.length, 5);
    assert.equal(reopened.status, 'En análisis');
});
import { c3Fixture, runFixture } from './validation-support.js';
test('Validada y Cerrada requieren caso pass y ambos modelos después del ajuste; parciales/release diferente rechazados', () => {
    let f = validateFinding({ ...findingFixture(), caseId: c3Fixture().cases[0].id });
    const ev = (to: string, i: number) => ({ id: 'step-' + i, at: `2026-10-11T0${i}:00:00Z`, by: personFixture, from: f.status, to, description: 'Paso de prueba', evidenceRef: refFixture, adjustmentRef: refFixture });
    for (const [i, state] of ['En análisis', 'En ajuste', 'Ajustada'].entries())
        f = transitionFinding(f, state as 'En análisis', ev(state, i + 1));
    const models = ['openai.gpt-oss-20b-1:0', 'openai.gpt-oss-120b-1:0'];
    const runs = models.map(targetModel => { const run = runFixture(); run.targetModel = targetModel; run.startedAt = '2026-10-11T03:01:00Z'; run.finishedAt = '2026-10-11T03:03:00Z'; for (const c of run.caseResults) {
        c.startedAt = run.startedAt;
        c.finishedAt = '2026-10-11T03:02:00Z';
        for (const a of c.attempts) {
            a.at = '2026-10-11T03:01:01Z';
            a.requestedModel = a.sentModel = a.effectiveModel = targetModel;
        }
    } return { run, ref: refFixture, verdicts: new Map([[f.caseId, 'pass' as const]]) }; });
    const proof = { matrix: c3Fixture(), runs, enabledModels: models, adjustmentReleaseRef: refFixture };
    assert.throws(() => transitionFinding(f, 'Validada', ev('Validada', 4), { ...proof, runs: runs.slice(0, 1) }));
    assert.throws(() => transitionFinding(f, 'Validada', ev('Validada', 4), { ...proof, runs: [{ ...runs[0], run: { ...runs[0].run, status: 'interrupted' } }, runs[1]] }));
    assert.throws(() => transitionFinding(f, 'Validada', ev('Validada', 4), { ...proof, adjustmentReleaseRef: { ...refFixture, sha256: 'b'.repeat(64) } }));
    assert.throws(() => transitionFinding(f, 'Validada', ev('Validada', 4), { ...proof, runs: [{ ...runs[0], verdicts: new Map([[f.caseId, 'pending']]) }, runs[1]] }));
    f = transitionFinding(f, 'Validada', ev('Validada', 4), proof);
    f = transitionFinding(f, 'Cerrada', ev('Cerrada', 5), proof);
    assert.equal(f.status, 'Cerrada');
    assert.equal(f.events.length, 6);
});
import { c4Fixture, c4RunFixture } from './validation-support.js';
test('C4 conserva entorno y exige matriz funcional completa posterior; no cierra por una sola fila', () => { const input = findingFixture(); delete (input as {
    evaluatedModel?: string;
}).evaluatedModel; input.priority = 'Alta'; input.events[0].priorityReview.signals = ['single-environment-failure']; let f = validateFinding({ ...input, environment: 'desktop', caseId: c4Fixture().cases[0].id }); const ev = (to: string, i: number) => ({ id: 'c4-event-' + i, at: `2026-10-11T0${i}:00:00Z`, by: personFixture, from: f.status, to, description: 'Verificación funcional sintética', evidenceRef: refFixture, adjustmentRef: refFixture }); for (const [i, state] of ['En análisis', 'En ajuste', 'Ajustada'].entries())
    f = transitionFinding(f, state as 'En análisis', ev(state, i + 1)); const run = c4RunFixture(); run.startedAt = '2026-10-11T03:01:00Z'; run.finishedAt = '2026-10-11T03:03:00Z'; run.caseResults = run.caseResults.map(c => ({ ...c, startedAt: run.startedAt, finishedAt: '2026-10-11T03:02:00Z' })); const proof = { matrix: c4Fixture(), runs: [{ run, ref: refFixture, verdicts: new Map([[f.caseId, 'pass' as const]]) }], enabledModels: [], adjustmentReleaseRef: refFixture }; assert.throws(() => transitionFinding(f, 'Validada', ev('Validada', 4), { ...proof, runs: [{ ...proof.runs[0], run: { ...run, caseResults: run.caseResults.slice(0, 1) } }] })); f = transitionFinding(f, 'Validada', ev('Validada', 4), proof); assert.equal(f.status, 'Validada'); });
