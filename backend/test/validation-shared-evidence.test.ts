import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLoadResults, validateUiResults, uiStates, manualCriteria } from '../scripts/lib/validation/sharedEvidence.js';
function wave(day: number, index: number) { return Array.from({ length: 25 }, (_, i) => ({ id: `W${index + 1}-${i}`, kind: 'simple', ms: 1000, status: 200, ok: true, autorizada: i < 15, historial: 0, larga: false, inicioMs: Date.parse(`2026-10-${day}T12:00:00Z`) + index * 125000, grupo: i < 15 ? 'autorizada' : 'anonima', ...(i < 15 ? { conversacion: i % 5, responseId: `r-${day}-${index}-${i}` } : {}) })); }
export const loadFixture = () => [10, 11].map(day => ({ modo: 'waves', muestras: [0, 1, 2].flatMap(i => wave(day, i)) }));
export const uiFixture = () => ({ states: uiStates.flatMap(state => ['host', 'shell', 'iframe'].map(context => ({ state, context, violations: [] }))), manual: manualCriteria.flatMap(criterion => ['desktop', 'mobile'].map(environment => ({ criterion, environment, verdict: 'pass', rationale: 'Comprobación manual sintética' }))), contrast: { normalText: 4.5, largeText: 3, controls: 3 }, zoomPercent: 200, readers: [{ environment: 'desktop', name: 'NVDA', version: 'fixture-1' }, { environment: 'mobile', name: 'TalkBack', version: 'fixture-1' }] });
test('IN03 reutiliza auditoría y p95 por cada oleada: seis, dos fechas y 150=90+60', () => { assert.equal(validateLoadResults(loadFixture()).total, 150); for (const mutate of [(x: ReturnType<typeof loadFixture>) => x.pop(), (x: ReturnType<typeof loadFixture>) => { x[1] = x[0]; }, (x: ReturnType<typeof loadFixture>) => { x[0].muestras.pop(); }, (x: ReturnType<typeof loadFixture>) => { x[0].muestras[0].ms = 50000; x[0].muestras[1].ms = 50000; }, (x: ReturnType<typeof loadFixture>) => { x[0].muestras[0].grupo = 'anonima'; }]) {
    const bad = loadFixture();
    mutate(bad);
    assert.throws(() => validateLoadResults(bad));
} });
test('UI02 exige todos los estados/contextos, manual completo, lector/version, contraste y zoom', () => { assert.doesNotThrow(() => validateUiResults(uiFixture())); for (const mutate of [(x: ReturnType<typeof uiFixture>) => x.states.pop(), (x: ReturnType<typeof uiFixture>) => x.manual.pop(), (x: ReturnType<typeof uiFixture>) => { x.zoomPercent = 100; }, (x: ReturnType<typeof uiFixture>) => { x.contrast.normalText = 4.4; }, (x: ReturnType<typeof uiFixture>) => x.readers.pop()]) {
    const bad = uiFixture();
    mutate(bad);
    assert.throws(() => validateUiResults(bad));
} });

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeImmutable } from '../scripts/lib/validation/artifacts.js';
import { verifyShared } from '../scripts/lib/validation/sharedEvidence.js';
import { personFixture } from './validation-support.js';
test('shared liga resultados, recibo humano y entorno; otra release, hash, stub y emulación se rechazan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'validation-shared-'));
    const evidence = await writeImmutable(root, 'evidence.json', { fixture: 'Controlled synthetic evidence only' });
    const releaseRef = await writeImmutable(root, 'release.json', { fixture: 'Synthetic identity' });
    const result = await writeImmutable(root, 'ui.json', uiFixture());
    const env = { schemaVersion: 1, id: 'synthetic-device', os: 'Synthetic OS', osVersion: '1', browser: 'Chromium', browserVersion: '1', device: 'Synthetic device', deviceKind: 'physical', viewport: { width: 390, height: 844 }, screenReader: { name: 'Synthetic reader', version: '1' }, hostUrl: 'https://fixture.invalid/host', chatUrl: 'https://fixture.invalid/chat', connection: 'real', evidenceRef: evidence };
    const desktop = await writeImmutable(root, 'desktop.json', { ...env, id: 'synthetic-desktop', viewport: { width: 1366, height: 768 } });
    const mobile = await writeImmutable(root, 'mobile.json', env);
    const receipt = { schemaVersion: 1, id: 'synthetic-review', resultHashes: [result.sha256], releaseRef, by: personFixture, at: '2026-10-10T06:00:00Z', verdict: 'pass', rationale: 'Synthetic test of receipt binding', evidenceRef: evidence };
    const manual = await writeImmutable(root, 'manual.json', receipt);
    const shared = { schemaVersion: 1, id: 'synthetic-ui', requirementId: 'RNF-C4-UI-02', ownerSpec: '004', releaseRef, executedAt: '2026-10-10T05:00:00Z', reportRef: evidence, resultRefs: [result], manualReviewRefs: [manual], verdict: 'pass', quantities: { ownerCaseId: 'N02', executionEnvironmentRefs: [desktop, mobile], rawResultRefs: [result] } };
    assert.equal((await verifyShared(root, shared, releaseRef)).verdict, 'pass');
    for (const bad of [{ ...shared, releaseRef: evidence }, { ...shared, resultRefs: [{ ...result, sha256: 'b'.repeat(64) }] }, { ...shared, quantities: { ...shared.quantities, rawResultRefs: [evidence] } }]) await assert.rejects(verifyShared(root, bad, releaseRef));
    for (const [key, patch] of [['emulated', { deviceKind: 'emulated' }], ['stub', { connection: 'stub' }], ['reader', { screenReader: null }]] as const) {
        const badEnv = await writeImmutable(root, key + '.json', { ...env, ...patch });
        await assert.rejects(verifyShared(root, { ...shared, quantities: { ...shared.quantities, executionEnvironmentRefs: [desktop, badEnv] } }, releaseRef));
    }
    const badReview = await writeImmutable(root, 'bad-review.json', { ...receipt, resultHashes: [evidence.sha256] });
    await assert.rejects(verifyShared(root, { ...shared, manualReviewRefs: [badReview] }, releaseRef));
});
