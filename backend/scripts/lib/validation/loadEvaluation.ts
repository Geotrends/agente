import { matrixC4 } from './matrixC4.js';
import { verifyFreezeC4 } from './freezeC4.js';
import { executionEnvironment, assertRealEnvironment } from './environments.js';
import { jsonArtifact, readArtifact } from './artifacts.js';
import { validateRun, verifyRunArtifacts, type Verdict } from './runs.js';
import { matrixC3 } from './matrixC3.js';
import { verifyFreeze } from './freeze.js';
import { verifyRelease } from './identity.js';
import { validateReview, deriveResult } from './review.js';
import { contentHash } from './hash.js';
import { object, version, ref, fail, type ArtifactRef } from './types.js';
export async function loadEvaluation(root: string, runRef: ArtifactRef, reviewRefs: ArtifactRef[]) {
    const value = await jsonArtifact(root, runRef) as Record<string, unknown>;
    const matrixValue = await jsonArtifact(root, value.matrixRef) as Record<string, unknown>;
    const matrix = matrixValue.kind === 'c4' ? matrixC4(matrixValue, matrixC3(await jsonArtifact(root, matrixValue.c3MatrixRef), false), false) : matrixC3(matrixValue, false);
    const run = validateRun(value, matrix);
    await verifyRunArtifacts(root, run);
    await (run.suite === 'c4' ? verifyFreezeC4 : verifyFreeze)(root, run.matrixRef, await jsonArtifact(root, run.freezeRef), new Date(run.startedAt));
    const release = await verifyRelease(root, await jsonArtifact(root, run.releaseRef));
    const verdicts = new Map<string, Verdict>();
    for (const result of run.caseResults) {
        const required = run.suite === 'c3' ? ['key-facts', 'sources-semantic', 'result-type-semantic', ...('kind' in matrix && matrix.kind === 'c3' && matrix.cases.find(c => c.id === result.caseId)?.family === 'manipulation' ? ['safeguards'] : [])] : ['expected-semantic', 'device', 'reader'];
        if (required.some(c => !result.manualChecksRequired.includes(c)))
            fail('semantic_reviews_missing_from_raw');
        if (run.suite === 'c4') {
            const e = executionEnvironment(await jsonArtifact(root, result.executionEnvironmentRef));
            await readArtifact(root, e.evidenceRef);
        }
        const observed = object(await jsonArtifact(root, result.observedRef), ['schemaVersion', 'caseId', 'adapter', 'response', 'attempts', 'promptLeak', 'exposedPointIds']);
        version(observed.schemaVersion);
        if (observed.caseId !== result.caseId || observed.adapter !== run.adapter || contentHash(observed.attempts) !== contentHash(result.attempts))
            fail('observation_provenance');
        const receipts = [];
        for (const reference of reviewRefs) {
            const raw = await jsonArtifact(root, ref(reference)) as Record<string, unknown>;
            if (raw.caseId !== result.caseId && raw.scope !== 'case:' + result.caseId)
                continue;
            const review = validateReview(raw, { runId: run.runId, result, matrixHash: contentHash(matrix), releaseId: release.releaseId });
            await readArtifact(root, review.evidenceRef);
            if (result.executionEnvironmentRef && review.checksReviewed.some(c => ['device', 'reader'].includes(c))) assertRealEnvironment(executionEnvironment(await jsonArtifact(root, result.executionEnvironmentRef)), result.environment!, review.checksReviewed.includes('reader'));
            receipts.push(review);
        }
        verdicts.set(result.caseId, deriveResult(result, receipts));
    }
    if (run.adapter === 'aws' && matrix.kind === 'c3') {
        const fragments = matrix.cases.filter(c => c.attack?.surface === 'fragment');
        if (run.cleanupRefs.length < fragments.length) fail('cleanup_receipts_pending');
        const receipts = [];
        for (const reference of run.cleanupRefs) {
            const receipt = object(await jsonArtifact(root, reference), ['schemaVersion', 'id', 'scope', 'documentKey', 'before', 'after', 'retrievable', 'at', 'by']);
            version(receipt.schemaVersion);
            const scope = object(receipt.scope, ['databaseName', 'alias', 'officialAlias', 'baseRef', 'copyRef', 'syntheticOnly']);
            const { assertAttackScope } = await import('./attackBase.js');
            assertAttackScope(scope as unknown as import('./attackBase.js').AttackScope);
            if (contentHash(scope.baseRef) !== contentHash(matrix.baseRef)) fail('cleanup_base');
            await readArtifact(root, ref(scope.copyRef));
            const after = object(receipt.after, ['documentIds', 'pointIds']);
            if (!Array.isArray(after.documentIds) || !Array.isArray(after.pointIds) || after.documentIds.length || after.pointIds.length || !Array.isArray(receipt.retrievable) || receipt.retrievable.length) fail('cleanup_remaining');
            receipts.push(receipt);
        }
        for (const row of fragments) {
            const result = run.caseResults.find(c => c.caseId === row.id);
            if (!result) continue;
            const observed = await jsonArtifact(root, result.observedRef) as {exposedPointIds: unknown[]};
            if (!Array.isArray(observed.exposedPointIds) || !observed.exposedPointIds.length || !receipts.some(r => {
                const before = object(r.before, ['documentIds', 'pointIds']);
                const points = before.pointIds;
                return Array.isArray(points) && observed.exposedPointIds.every(p => points.includes(p));
            })) fail('fragment_exposure_receipt');
        }
    }
    for (const reference of reviewRefs) {
        const receipt = await jsonArtifact(root, reference) as Record<string, unknown>;
        if (receipt.runId !== run.runId || !run.caseResults.some(c => c.caseId === receipt.caseId || receipt.scope === 'case:' + c.caseId))
            fail('review_not_in_run');
    }
    return { run, runRef, matrix, release, verdicts };
}
