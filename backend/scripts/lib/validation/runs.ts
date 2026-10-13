import { object, version, id, instant, enumeration, ref, list, text, unique, finite, fail, type ArtifactRef } from './types.js';
import type { Attempt } from './invocations.js';
import type { MatrixC3 } from './matrixC3.js';
import { readArtifact, writeImmutable, appendEvent } from './artifacts.js';
import { contentHash } from './hash.js';
import { ALLOWED_BEDROCK_MODELS } from '../../../src/services/diConfig.js';
export type Verdict = 'pass' | 'fail' | 'pending';
export type Check = {
    id: string;
    status: Verdict;
    reason: string;
};
export type CaseResult = {
    caseId: string;
    environment?: 'desktop' | 'mobile';
    executionEnvironmentRef?: ArtifactRef;
    startedAt: string;
    finishedAt: string;
    observedRef: ArtifactRef;
    evidenceRefs: ArtifactRef[];
    checks: Check[];
    automaticVerdict: Verdict;
    manualChecksRequired: string[];
    localReason?: string;
    attempts: Attempt[];
};
export type Run = {
    schemaVersion: 1;
    runId: string;
    matrixRef: ArtifactRef;
    freezeRef: ArtifactRef;
    releaseRef: ArtifactRef;
    suite: 'c3' | 'c4';
    mode: 'integrated' | 'independent' | 'functional';
    adapter: 'aws' | 'double' | 'controlled';
    targetModel?: string;
    startedAt: string;
    finishedAt: string | null;
    status: 'running' | 'complete' | 'interrupted' | 'invalid';
    caseResults: CaseResult[];
    cleanupRefs: ArtifactRef[];
    artifacts: ArtifactRef[];
};
export function caseResult(value: unknown, suite: 'c3' | 'c4', target?: string): CaseResult {
    const o = object(value, ['caseId', 'environment', 'executionEnvironmentRef', 'startedAt', 'finishedAt', 'observedRef', 'evidenceRefs', 'checks', 'automaticVerdict', 'manualChecksRequired', 'localReason', 'attempts'], ['caseId', 'startedAt', 'finishedAt', 'observedRef', 'evidenceRefs', 'checks', 'automaticVerdict', 'manualChecksRequired', 'attempts']);
    id(o.caseId);
    instant(o.startedAt);
    instant(o.finishedAt);
    if (Date.parse(String(o.finishedAt)) < Date.parse(String(o.startedAt)))
        fail('case_time');
    ref(o.observedRef);
    list(o.evidenceRefs, 1).forEach(ref);
    const checks = list(o.checks, 1).map(v => { const c = object(v, ['id', 'status', 'reason']); id(c.id); enumeration(c.status, ['pass', 'fail', 'pending']); text(c.reason); return c as unknown as Check; });
    unique(checks, c => c.id);
    const verdict = enumeration(o.automaticVerdict, ['pass', 'fail', 'pending']);
    if (checks.some(c => c.status === 'fail') && verdict !== 'fail' || checks.some(c => c.status === 'pending') && verdict === 'pass')
        fail('check_verdict');
    const manual = list(o.manualChecksRequired).map(id);
    unique(manual, c => c);
    if (o.localReason !== undefined)
        text(o.localReason);
    if (suite === 'c4') {
        enumeration(o.environment, ['desktop', 'mobile']);
        ref(o.executionEnvironmentRef);
    }
    else if (o.environment !== undefined || o.executionEnvironmentRef !== undefined)
        fail('c3_environment');
    const attempts = list(o.attempts).map(v => {
        const a = object(v, ['attemptIndex', 'requestedModel', 'sentModel', 'effectiveModel', 'status', 'at', 'requestId', 'usage', 'errorCode'], ['attemptIndex', 'requestedModel', 'sentModel', 'status', 'at']);
        if (!Number.isSafeInteger(finite(a.attemptIndex)) || Number(a.attemptIndex) < 1)
            fail('attempt_index');
        text(a.requestedModel);
        text(a.sentModel);
        enumeration(a.status, ['success', 'failure']);
        instant(a.at);
        if (Date.parse(String(a.at)) < Date.parse(String(o.startedAt)) || Date.parse(String(a.at)) > Date.parse(String(o.finishedAt)))
            fail('attempt_time');
        if (a.status === 'success') {
            text(a.effectiveModel);
            if (a.effectiveModel !== a.sentModel)
                fail('effective_model');
            const usage = object(a.usage, ['inputTokens', 'outputTokens']);
            for (const n of Object.values(usage))
                if (!Number.isSafeInteger(finite(n)) || Number(n) < 0)
                    fail('usage');
        }
        else if (a.effectiveModel !== null && a.effectiveModel !== undefined)
            fail('failure_effective_model');
        if (a.requestId !== undefined && !/^[a-zA-Z0-9._:-]{1,200}$/.test(text(a.requestId)))
            fail('request_id');
        if (a.errorCode !== undefined && !/^[a-zA-Z0-9._:-]{1,100}$/.test(text(a.errorCode)))
            fail('error_code');
        return a as unknown as Attempt;
    });
    unique(attempts, a => String(a.attemptIndex));
    if (attempts.some((a, i) => a.attemptIndex !== i + 1))
        fail('attempt_order');
    if (suite === 'c3' && !attempts.length && !o.localReason)
        fail('local_reason');
    if (target && attempts.length) {
        if (attempts.length !== 1 || attempts[0].requestedModel !== target || attempts[0].sentModel !== target || attempts[0].status === 'success' && attempts[0].effectiveModel !== target)
            fail('independent_attempts');
    }
    return o as unknown as CaseResult;
}
export function validateRun(value: unknown, matrix: {
    cases: readonly {
        id: string;
        environment?: 'desktop' | 'mobile';
    }[];
}): Run {
    const o = object(value, ['schemaVersion', 'runId', 'matrixRef', 'freezeRef', 'releaseRef', 'suite', 'mode', 'adapter', 'targetModel', 'startedAt', 'finishedAt', 'status', 'caseResults', 'cleanupRefs', 'artifacts'], ['schemaVersion', 'runId', 'matrixRef', 'freezeRef', 'releaseRef', 'suite', 'mode', 'adapter', 'startedAt', 'status', 'caseResults', 'cleanupRefs', 'artifacts']);
    version(o.schemaVersion);
    id(o.runId);
    ref(o.matrixRef);
    ref(o.freezeRef);
    ref(o.releaseRef);
    const suite = enumeration(o.suite, ['c3', 'c4']);
    const mode = enumeration(o.mode, ['integrated', 'independent', 'functional']);
    enumeration(o.adapter, ['aws', 'double', 'controlled']);
    const status = enumeration(o.status, ['running', 'complete', 'interrupted', 'invalid']);
    instant(o.startedAt);
    if (suite === 'c3' && mode === 'functional' || suite === 'c4' && mode !== 'functional')
        fail('suite_mode');
    if (mode === 'independent')
        enumeration(o.targetModel, ALLOWED_BEDROCK_MODELS);
    else if (o.targetModel !== undefined)
        fail('target_only_independent');
    if (status === 'complete') {
        instant(o.finishedAt);
        if (Date.parse(String(o.finishedAt)) < Date.parse(String(o.startedAt)))
            fail('run_time');
    }
    else if (o.finishedAt !== undefined && o.finishedAt !== null)
        instant(o.finishedAt);
    const results = list(o.caseResults).map(v => caseResult(v, suite, typeof o.targetModel === 'string' ? o.targetModel : undefined));
    unique(results, c => c.caseId);
    if (results.some(r => !matrix.cases.some(c => c.id === r.caseId)))
        fail('unknown_case');
    if (suite === 'c4' && results.some(r => matrix.cases.find(c => c.id === r.caseId)?.environment !== r.environment))
        fail('case_environment');
    if (status === 'complete' && (results.length !== matrix.cases.length || matrix.cases.some(c => !results.some(r => r.caseId === c.id))))
        fail('incomplete_run');
    if (results.some(r => Date.parse(r.startedAt) < Date.parse(String(o.startedAt)) || o.finishedAt && Date.parse(r.finishedAt) > Date.parse(String(o.finishedAt))))
        fail('result_run_time');
    list(o.cleanupRefs).forEach(ref);
    list(o.artifacts).forEach(ref);
    return o as unknown as Run;
}
export async function verifyRunArtifacts(root: string, r: Run): Promise<void> { for (const reference of [r.matrixRef, r.freezeRef, r.releaseRef, ...r.cleanupRefs, ...r.artifacts, ...r.caseResults.flatMap(c => [c.observedRef, ...c.evidenceRefs, ...(c.executionEnvironmentRef ? [c.executionEnvironmentRef] : [])])])
    await readArtifact(root, reference); }
export async function checkpoint(root: string, r: Run, matrix: MatrixC3): Promise<ArtifactRef> {
    validateRun(r, matrix);
    const path = `runs/${r.runId}/checkpoints/${r.caseResults.length}-${r.status}.json`;
    const result = await writeImmutable(root, path, r);
    await appendEvent(root, 'events', { schemaVersion: 1, id: `${r.runId}-${r.caseResults.length}-${r.status}`, kind: r.status === 'complete' ? 'run-complete' : r.status === 'running' ? 'run-progress' : 'run-interrupted', at: new Date().toISOString(), runId: r.runId, runRef: result, matrixHash: contentHash(matrix) });
    return result;
}
