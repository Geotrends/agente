import test from 'node:test';
import assert from 'node:assert/strict';
import { validateActa, verifyActa } from '../scripts/lib/validation/actas.js';
import { packageInput } from '../scripts/lib/validation/packages.js';
import { personFixture, refFixture } from './validation-support.js';
test('acta sintética: partes exactas, fechas posteriores, versiones/hash y ready técnico', () => { const context = { milestone: 'H5-C3' as const, ready: true, reportHash: refFixture.sha256, matrixVersion: '1', models: ['model-one', 'model-two'], chatbotVersion: 'fixture-bundle', lastFinishedAt: '2026-10-10T01:00:00Z' }; const receipt = { signedFileRef: refFixture, reportHash: refFixture.sha256, matrixVersion: '1', validatedModels: context.models, signatories: ['supervisión', 'Geotrends'].map(party => ({ party, person: personFixture, signedAt: '2026-10-10T02:00:00Z' })), verifiedBy: personFixture, verifiedAt: '2026-10-10T03:00:00Z', signatureEvidenceRef: refFixture }; assert.doesNotThrow(() => validateActa(receipt, context)); for (const bad of [{ ...receipt, signatories: receipt.signatories.slice(0, 1) }, { ...receipt, reportHash: 'b'.repeat(64) }, { ...receipt, matrixVersion: '2' }, { ...receipt, validatedModels: ['model-one'] }, { ...receipt, signatories: receipt.signatories.map(s => ({ ...s, signedAt: context.lastFinishedAt })) }, { ...receipt, status: 'signed' }])
    assert.throws(() => validateActa(bad, context)); assert.throws(() => validateActa(receipt, { ...context, ready: false })); });
test('expediente no admite ausencia de insumos ni estado firmado declarado por JSON de entrada', () => { const input = { schemaVersion: 1, id: 'fixture-package', milestone: 'H5-C3', releaseRef: refFixture, matrixRef: refFixture, runs: [], findingsRef: refFixture, adjustmentsRef: refFixture, sharedVerificationRefs: [], sourceGatesRef: refFixture }; assert.equal(packageInput(input).runs.length, 0); assert.throws(() => packageInput({ ...input, status: 'signed' })); assert.throws(() => packageInput({ ...input, findingsRef: undefined })); });
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactFixture } from './validation-support.js';
import { writeImmutable, jsonArtifact, artifact } from '../scripts/lib/validation/artifacts.js';
import { sourceRequirements } from '../scripts/lib/validation/sourceRequirements.js';
import { main } from '../scripts/validation.js';
test('report genera draft inmutable; require-ready bloquea ausencia de corridas y PASS nominal; acta no firma draft', async () => { const root = await mkdtemp(join(tmpdir(), 'validation-delivery-')); const f = await artifactFixture(root); const empty = await writeImmutable(root, 'empty.json', []); const evidence = await writeImmutable(root, 'human-fixture.json', { fixture: 'No firma real ni evidencia de aceptación' }); const sourceGatesRef = await writeImmutable(root, 'source-gates.json', { schemaVersion: 1, releaseRef: f.releaseRef, requiredRequirementIds: sourceRequirements, gates: sourceRequirements.map(requirementId => ({ requirementId, verdict: 'pass', reason: 'Declaración sintética sin resultados', evidenceRefs: [evidence] })), by: personFixture, at: '2026-10-10T06:00:00Z', evidenceRef: evidence }); const input = { schemaVersion: 1, id: 'fixture-package', milestone: 'H5-C3', releaseRef: f.releaseRef, matrixRef: f.matrixRef, runs: [], findingsRef: empty, adjustmentsRef: empty, sharedVerificationRefs: [], sourceGatesRef }; await writeImmutable(root, 'input.json', input); assert.equal(await main(['report', `--root=${root}`, '--milestone=H5-C3', '--package=input.json', '--output=draft']), 0); assert.equal(await main(['report', `--root=${root}`, '--milestone=H5-C3', '--package=input.json', '--output=ready-attempt', '--require-ready']), 1); const pkg = await jsonArtifact(root, await artifact(root, 'draft/expediente.json', 'application/json')) as {
    status: string;
    gateVerdicts: {
        verdict: string;
    }[];
}; assert.equal(pkg.status, 'draft'); assert.ok(pkg.gateVerdicts.some(g => g.verdict === 'pending')); await assert.rejects(main(['acta', `--root=${root}`, '--package=draft/expediente.json', '--receipt=human-fixture.json', '--output=signed.json'])); await assert.rejects(main(['report', `--root=${root}`, '--milestone=H5-C3', '--package=input.json', '--output=draft'])); });

import { assessPackage } from '../scripts/lib/validation/packages.js';
import { contentHash } from '../scripts/lib/validation/hash.js';
import { appendEvent } from '../scripts/lib/validation/artifacts.js';
import { runFixture, findingFixture } from './validation-support.js';
import type { Run } from '../scripts/lib/validation/runs.js';
// All artifacts below live in a temporary test root. 'aws' and physical observations
// are synthetic contract fixtures, never exported as official acceptance evidence.
async function completePackageFixture() {
    const root = await mkdtemp(join(tmpdir(), 'validation-package-synthetic-'));
    const f = await artifactFixture(root);
    const release = await jsonArtifact(root, f.releaseRef) as Record<string, unknown>;
    const environment = await jsonArtifact(root, release.environmentRef) as Record<string, unknown>;
    release.environmentRef = await writeImmutable(root, 'synthetic-real-environment.json', { ...environment, executionClass: 'real' });
    const releaseRef = await writeImmutable(root, 'synthetic-release.json', release);
    const evidence = await writeImmutable(root, 'synthetic-proof.json', { fixture: 'Synthetic evidence only; no AWS call or approval' });
    const cleanupRefs = await Promise.all(f.matrix.cases.filter(c => c.attack?.surface === 'fragment').map(c => writeImmutable(root, `cleanup-${c.id}.json`, { schemaVersion: 1, id: 'cleanup-' + c.id, scope: { databaseName: 'validation_fixture', alias: 'validation_fixture', officialAlias: 'kb_chunks', baseRef: f.matrix.baseRef, copyRef: evidence, syntheticOnly: true }, documentKey: c.id, before: { documentIds: ['synthetic-document'], pointIds: [c.id] }, after: { documentIds: [], pointIds: [] }, retrievable: [], at: '2026-10-11T01:01:00Z', by: personFixture })));
    const runs: { runRef: typeof evidence; reviewRefs: typeof evidence[] }[] = [];
    for (const [index, model] of [null, ...release.enabledModels as string[]].entries()) {
        const run: Run = { ...runFixture(), runId: 'synthetic-run-' + index, mode: model ? 'independent' : 'integrated', adapter: 'aws', matrixRef: f.matrixRef, freezeRef: f.freezeRef, releaseRef, cleanupRefs, artifacts: [] };
        if (model) run.targetModel = model; else delete run.targetModel;
        for (const [i, result] of run.caseResults.entries()) {
            const row = f.matrix.cases[i];
            result.attempts = model ? result.attempts.map(a => ({ ...a, requestedModel: model, sentModel: model, effectiveModel: model })) : [];
            if (!model) result.localReason = 'Synthetic local response';
            result.manualChecksRequired = ['key-facts', 'sources-semantic', 'result-type-semantic', ...(row.family === 'manipulation' ? ['safeguards'] : [])];
            result.observedRef = await writeImmutable(root, `${run.runId}/${row.id}-observed.json`, { schemaVersion: 1, caseId: row.id, adapter: 'aws', response: { fixture: 'Synthetic recorded response' }, attempts: result.attempts, promptLeak: false, exposedPointIds: row.attack?.surface === 'fragment' ? [row.id] : [] });
            result.evidenceRefs = [result.observedRef];
        }
        const runRef = await writeImmutable(root, run.runId + '.json', run);
        const reviewRefs = await Promise.all(run.caseResults.map(r => writeImmutable(root, `${run.runId}/${r.caseId}-review.json`, { schemaVersion: 1, id: `${run.runId}-${r.caseId}`, runId: run.runId, caseId: r.caseId, resultHash: contentHash(r), matrixHash: contentHash(f.matrix), releaseId: release.releaseId, by: personFixture, at: '2026-10-11T03:00:00Z', checksReviewed: r.manualChecksRequired, verdict: 'pass', rationale: 'Synthetic semantic contract verification', evidenceRef: evidence })));
        runs.push({ runRef, reviewRefs });
    }
    const gates = await Promise.all(sourceRequirements.map(async requirementId => {
        const evidenceRef = await writeImmutable(root, `source/${requirementId}.json`, { schemaVersion: 1, requirementId, releaseRef, ownerSpec: ({ IV: '001', DI: '002', DC: '003', UI: '004', IN: '005' } as Record<string, string>)[requirementId.split('-')[2]], ownerCaseId: 'synthetic-owner-case', runnerRef: evidence, status: 'complete', executionClass: 'real', verdict: 'pass', criteria: [{ id: 'synthetic-criterion', status: 'pass', observed: 'Synthetic complete result', expected: 'Synthetic complete result' }], executedAt: '2026-10-11T03:00:00Z', evidenceRefs: [evidence] });
        return { requirementId, verdict: 'pass', reason: 'Synthetic source gate contract', evidenceRefs: [evidenceRef] };
    }));
    const sourceGatesRef = await writeImmutable(root, 'source-gates-complete.json', { schemaVersion: 1, releaseRef, requiredRequirementIds: sourceRequirements, gates, by: personFixture, at: '2026-10-11T04:00:00Z', evidenceRef: evidence });
    const empty = await writeImmutable(root, 'empty.json', []);
    const input = { schemaVersion: 1, id: 'synthetic-complete-package', milestone: 'H5-C3', releaseRef, matrixRef: f.matrixRef, runs, findingsRef: empty, adjustmentsRef: empty, sharedVerificationRefs: [], sourceGatesRef };
    return { root, input, evidence };
}
test('expediente completo sintético; revisiones, modelos, integrado, Críticos y corrida posterior son puertas independientes', async () => {
    const { root, input, evidence } = await completePackageFixture();
    assert.equal((await assessPackage(root, input)).ready, true);
    for (const runs of [input.runs.slice(1), input.runs.slice(0, 2), input.runs.map(r => ({ ...r, reviewRefs: [] }))]) assert.equal((await assessPackage(root, { ...input, runs })).ready, false);
    const critical = { ...findingFixture(), matrixRef: input.matrixRef, caseId: 'GT-P-1-0', originRunId: 'synthetic-run-1', events: findingFixture().events.map(e => ({ ...e, evidenceRef: evidence, priorityReview: { ...e.priorityReview, evidenceRef: evidence } })) };
    const findingsRef = await writeImmutable(root, 'critical.json', [critical]);
    assert.equal((await assessPackage(root, { ...input, findingsRef })).ready, false);
    const source = await jsonArtifact(root, input.sourceGatesRef) as { gates: {requirementId: string; verdict: string}[] };
    for (const family of ['DI', 'UI', 'IN']) {
        const altered = structuredClone(source);
        altered.gates.find(g => g.requirementId.split('-')[2] === family)!.verdict = 'fail';
        const sourceGatesRef = await writeImmutable(root, `source-failed-${family}.json`, altered);
        assert.equal((await assessPackage(root, { ...input, sourceGatesRef })).ready, false);
    }
    const old = await jsonArtifact(root, input.runs[1].runRef) as Run;
    const interrupted = { ...old, runId: 'synthetic-later-interrupted', startedAt: '2026-10-11T05:00:00Z', finishedAt: '2026-10-11T05:01:00Z', status: 'interrupted', caseResults: [] };
    const laterRef = await writeImmutable(root, 'later.json', interrupted);
    await appendEvent(root, 'events', { id: 'later-interrupted', kind: 'run-interrupted', runId: interrupted.runId, at: interrupted.startedAt, runRef: laterRef });
    assert.equal((await assessPackage(root, input)).ready, false);
});

import { c4Fixture } from './validation-support.js';
test('H4 exige sus verificaciones independientes y versión ChatBot; original firmado inaccesible falla', async () => {
    const { root, input, evidence } = await completePackageFixture();
    const matrix = c4Fixture(); matrix.c3MatrixRef = input.matrixRef;
    const matrixRef = await writeImmutable(root, 'synthetic-c4.json', matrix);
    const release = await jsonArtifact(root, input.releaseRef) as {matrixRefs: typeof matrixRef[]};
    const releaseRef = await writeImmutable(root, 'synthetic-c4-release.json', { ...release, matrixRefs: [input.matrixRef, matrixRef] });
    // No C4 runs or shared proofs: these gates must remain explicitly pending.
    const draft = await assessPackage(root, { ...input, milestone: 'H4-C4', matrixRef, releaseRef, runs: [], sourceGatesRef: await writeImmutable(root, 'h4-source-gates.json', { ...(await jsonArtifact(root, input.sourceGatesRef) as object), releaseRef }) });
    assert.equal(draft.ready, false);
    for (const requirement of ['run-functional', 'RNF-C4-UI-02', 'RNF-C3-IN-03']) assert.equal(draft.gates.find(g => g.requirementId === requirement)?.verdict, 'pending');
    const context = { milestone: 'H4-C4' as const, ready: true, reportHash: evidence.sha256, matrixVersion: '1', models: ['synthetic-model'], chatbotVersion: 'synthetic-bundle', lastFinishedAt: '2026-10-10T01:00:00Z' };
    const receipt = { signedFileRef: { ...evidence, path: 'missing-original.pdf' }, reportHash: evidence.sha256, matrixVersion: '1', chatbotVersion: 'synthetic-bundle', signatories: ['supervisión', 'Geotrends'].map(party => ({ party, person: personFixture, signedAt: '2026-10-10T02:00:00Z' })), verifiedBy: personFixture, verifiedAt: '2026-10-10T03:00:00Z', signatureEvidenceRef: evidence };
    assert.doesNotThrow(() => validateActa(receipt, context));
    assert.throws(() => validateActa({ ...receipt, chatbotVersion: 'other-bundle' }, context));
    await assert.rejects(verifyActa(root, receipt, context));
});
