import test from 'node:test';
import assert from 'node:assert/strict';
import { contentHash } from '../scripts/lib/validation/hash.js';
import { validateRun } from '../scripts/lib/validation/runs.js';
import { evaluateRun, latestRun } from '../scripts/lib/validation/evaluation.js';
import { validateReview, deriveResult } from '../scripts/lib/validation/review.js';
import { c3Fixture, refFixture, personFixture, runFixture } from './validation-support.js';
import type { ReviewReceipt } from '../scripts/lib/validation/review.js';
import type { CaseResult } from '../scripts/lib/validation/runs.js';
test('complete exige todos los IDs una vez; modelo no se atribuye a respuesta local', () => {
    const r = runFixture(), m = c3Fixture();
    assert.equal(validateRun(r, m).caseResults.length, 39);
    for (const bad of [{ ...r, caseResults: r.caseResults.slice(1) }, { ...r, caseResults: [...r.caseResults, r.caseResults[0]] }, { ...r, targetModel: 'another' }, { ...r, mode: 'integrated', targetModel: r.targetModel }, { ...r, only: ['one'] }, { ...r, status: 'unknown' }])
        assert.throws(() => validateRun(bad, m));
    const local = structuredClone(r);
    local.caseResults[0].attempts = [];
    assert.throws(() => validateRun(local, m));
    local.caseResults[0].localReason = 'Ausencia documental local';
    assert.equal(validateRun(local, m).caseResults[0].attempts.length, 0);
    const repeat = structuredClone(r);
    repeat.caseResults[0].attempts.push({ ...repeat.caseResults[0].attempts[0], attemptIndex: 2 });
    assert.throws(() => validateRun(repeat, m));
});
test('N39 exige36 por corrida, pendientes no suman; protegidos y doble nunca aceptación', () => {
    const m = c3Fixture(), r = runFixture();
    const v = new Map(r.caseResults.map(x => [x.caseId, 'pass' as const]));
    let s = evaluateRun(r, m, v);
    assert.equal(s.required, 36);
    assert.equal(s.realAcceptance, false);
    const mutable = new Map<string, 'pass' | 'fail' | 'pending'>(v);
    for (let i = 0; i < 4; i++)
        mutable.set(r.caseResults[i].caseId, 'pending');
    s = evaluateRun(r, m, mutable);
    assert.equal(s.conformant, false);
    assert.equal(s.passed, 35);
    const protectedId = m.cases.find(c => c.expected.type === 'sin información')!.id;
    const oneFail = new Map<string, 'pass' | 'fail' | 'pending'>(v);
    oneFail.set(protectedId, 'fail');
    assert.equal(evaluateRun(r, m, oneFail).conformant, false);
});
test('review liga hash bruto/matriz/release; firma no salva fallo automático; derivado no muta raw', () => {
    const raw: CaseResult = { ...runFixture().caseResults[0], manualChecksRequired: ['sources'] };
    const before = contentHash(raw);
    const receipt: ReviewReceipt = { schemaVersion: 1, id: 'review-1', runId: 'fixture-run', caseId: raw.caseId, resultHash: before, matrixHash: contentHash(c3Fixture()), releaseId: 'release-1', by: personFixture, at: '2026-10-11T03:00:00Z', checksReviewed: ['sources'], verdict: 'pass', rationale: 'Cotejo sintético', evidenceRef: refFixture };
    validateReview(receipt, { runId: 'fixture-run', result: raw, matrixHash: contentHash(c3Fixture()), releaseId: 'release-1' });
    assert.throws(() => validateReview({ ...receipt, resultHash: 'b'.repeat(64) }, { runId: 'fixture-run', result: raw, matrixHash: contentHash(c3Fixture()), releaseId: 'release-1' }));
    assert.equal(deriveResult(raw, []), 'pending');
    assert.equal(deriveResult(raw, [receipt]), 'pass');
    assert.equal(contentHash(raw), before);
    assert.equal(deriveResult({ ...raw, automaticVerdict: 'fail' }, [receipt]), 'fail');
});
test('última corrida interrumpida o ajuste posterior impide escoger éxito viejo', () => {
    const r = runFixture();
    const later = { ...r, runId: 'later', startedAt: '2026-10-12T00:00:00Z', finishedAt: null, status: 'interrupted' as const };
    assert.equal(latestRun([r, later], []), null);
    assert.equal(latestRun([r], [{ at: '2026-10-12T00:00:00Z', invalidatedRunIds: [r.runId] }]), null);
    assert.equal(latestRun([r], [])?.runId, r.runId);
});
