import test from 'node:test';
import assert from 'node:assert/strict';
import { priorityFor, validateFinding } from '../scripts/lib/validation/findings.js';
import { findingFixture } from './validation-support.js';
test('rubricas exactas y prioridad mayor; no cuarto tipo REAL ni fallo inventado para revisión pendiente', () => {
    assert.equal(priorityFor('c3', ['key-fact-wrong', 'result-type-wrong']), 'Crítica');
    assert.equal(priorityFor('c3', ['citation-date-wrong']), 'Alta');
    assert.equal(priorityFor('c3', ['result-type-wrong']), 'Media');
    assert.equal(priorityFor('c4', ['claims-filing', 'aesthetic']), 'Crítica');
    assert.equal(priorityFor('c4', ['single-environment-failure']), 'Alta');
    const f = findingFixture();
    assert.equal(validateFinding(f).id, 'finding-1');
    for (const bad of [{ ...f, priority: 'Media' }, { ...f, failureType: 'Interfaz' }, { ...f, causeRationale: 'TODO' }, { ...f, evaluatedModel: undefined }, { ...f, events: [] }, { ...f, priority: 'Alta', environment: 'mobile' }])
        assert.throws(() => validateFinding(bad));
});
import { assertFindingCoverage } from '../scripts/lib/validation/findingValidation.js';
import { runFixture, c3Fixture } from './validation-support.js';
test('no aprobados no desaparecen: vínculo exacto por run/modelo; IDs repetidos e historia borrada se rechazan', () => { const run = runFixture(); const m = c3Fixture(); const pass = new Map(run.caseResults.map(c => [c.caseId, 'pass' as const])); const verdicts = new Map<string, ReadonlyMap<string, 'pass' | 'fail' | 'pending'>>([[run.runId, new Map([...pass, [m.cases[0].id, 'pending']])]]); assert.throws(() => assertFindingCoverage([run], verdicts, [])); const f = validateFinding({ ...findingFixture(), originRunId: run.runId, caseId: m.cases[0].id }); assert.doesNotThrow(() => assertFindingCoverage([run], verdicts, [f])); assert.throws(() => assertFindingCoverage([run], verdicts, [{ ...f, evaluatedModel: 'openai.gpt-oss-120b-1:0' }])); assert.throws(() => validateFinding({ ...f, events: [...f.events, f.events[0]] })); });
