/** Import physical/manual results into a pending functional run, retaining its ID. */
import { jsonArtifact, readArtifact, writeImmutable, appendEvent, artifact } from './artifacts.js';
import { matrixC3 } from './matrixC3.js';
import { matrixC4 } from './matrixC4.js';
import { verifyFreezeC4 } from './freezeC4.js';
import { verifyRelease } from './identity.js';
import { validateRun, caseResult, verifyRunArtifacts } from './runs.js';
import { executionEnvironment, assertRealEnvironment } from './environments.js';
import { validateReview } from './review.js';
import { contentHash } from './hash.js';
import { list, object, ref, version, fail, type ArtifactRef } from './types.js';
async function stableWrite(root: string, path: string, value: unknown): Promise<ArtifactRef> { try {
    const existing = await artifact(root, path, 'application/json');
    if (contentHash(await jsonArtifact(root, existing)) !== contentHash(value))
        fail('manual_immutable_conflict');
    return existing;
}
catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error;
    return writeImmutable(root, path, value);
} }
export async function importPrResults(root: string, runRef: ArtifactRef, inputValue: unknown) {
    const value = await jsonArtifact(root, runRef) as Record<string, unknown>;
    const matrixValue = await jsonArtifact(root, value.matrixRef) as Record<string, unknown>;
    const matrix = matrixC4(matrixValue, matrixC3(await jsonArtifact(root, matrixValue.c3MatrixRef), false), false);
    const run = validateRun(value, matrix);
    if (run.suite !== 'c4' || run.status !== 'running')
        fail('manual_run_must_be_pending');
    await verifyFreezeC4(root, run.matrixRef, await jsonArtifact(root, run.freezeRef), new Date(run.startedAt));
    const release = await verifyRelease(root, await jsonArtifact(root, run.releaseRef));
    const input = object(inputValue, ['results', 'reviewRefs']);
    const reviewRefs = list(input.reviewRefs, 1).map(ref);
    const reviews = await Promise.all(reviewRefs.map(r => jsonArtifact(root, r)));
    const newResults = list(input.results, 1).map(v => caseResult(v, 'c4'));
    // Validate the entire batch before publishing any result or checkpoint.
    for (const raw of newResults) {
        if (run.caseResults.some(r => r.caseId === raw.caseId) || newResults.filter(r => r.caseId === raw.caseId).length !== 1 || !matrix.cases.some(c => c.id === raw.caseId && c.environment === raw.environment))
            fail('manual_case_duplicate_or_unknown');
        const env = executionEnvironment(await jsonArtifact(root, raw.executionEnvironmentRef));
        await readArtifact(root, env.evidenceRef);
        assertRealEnvironment(env, raw.environment!, true);
        for (const check of ['device', 'reader', 'expected-semantic'])
            if (!raw.manualChecksRequired.includes(check))
                fail('manual_checks_missing');
        const observed = object(await jsonArtifact(root, raw.observedRef), ['schemaVersion', 'caseId', 'adapter', 'response', 'attempts', 'promptLeak', 'exposedPointIds']);
        version(observed.schemaVersion);
        if (observed.caseId !== raw.caseId || observed.adapter !== run.adapter || contentHash(observed.attempts) !== contentHash(raw.attempts))
            fail('observation_provenance');
        const receipts = reviews.filter(r => (r as Record<string, unknown>).caseId === raw.caseId || (r as Record<string, unknown>).scope === 'case:' + raw.caseId).map(r => validateReview(r, { runId: run.runId, result: raw, matrixHash: contentHash(matrix), releaseId: release.releaseId }));
        for (const receipt of receipts)
            await readArtifact(root, receipt.evidenceRef);
        if (!receipts.length)
            fail('manual_receipt_missing');
    }
    run.caseResults.push(...newResults);
    run.status = run.caseResults.length === matrix.cases.length ? 'complete' : 'running';
    const path = `runs/${run.runId}/${run.status === 'complete' ? 'run.json' : 'manual-' + run.caseResults.length + '.json'}`;
    run.finishedAt = run.status === 'complete' ? new Date().toISOString() : null;
    try {
        const existing = await jsonArtifact(root, await artifact(root, path, 'application/json')) as typeof run;
        run.finishedAt = existing.finishedAt;
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            throw error;
    }
    validateRun(run, matrix);
    await verifyRunArtifacts(root, run);
    for (const raw of newResults)
        await stableWrite(root, `runs/${run.runId}/manual-results/${raw.caseId}.json`, raw);
    const output = await stableWrite(root, path, run);
    for (const reference of reviewRefs) {
        const receipt = await jsonArtifact(root, reference) as Record<string, unknown>;
        if (newResults.some(r => r.caseId === receipt.caseId || receipt.scope === 'case:' + r.caseId)) {
            const event = { id: String(receipt.id), kind: 'review', at: receipt.at, runRef: output, receiptRef: reference };
            await stableWrite(root, `events/${event.id}.json`, event);
        }
    }
    // Event ID is stable so a crash after publishing the run remains recoverable.
    const eventPath = `events/${run.runId}-manual-${run.caseResults.length}.json`;
    try {
        const previous = await jsonArtifact(root, await artifact(root, eventPath, 'application/json')) as Record<string, unknown>;
        if (contentHash(previous.runRef) !== contentHash(output))
            fail('manual_event_conflict');
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            throw error;
        await appendEvent(root, 'events', { id: run.runId + '-manual-' + run.caseResults.length, kind: run.status === 'complete' ? 'run-complete' : 'run-progress', at: new Date().toISOString(), runId: run.runId, runRef: output });
    }
    return { run, runRef: output };
}
