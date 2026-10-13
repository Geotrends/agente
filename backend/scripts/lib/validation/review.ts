import { object, version, id, sha, instant, person, list, enumeration, text, ref, unique, fail, type ArtifactRef, type PersonRef } from './types.js';
import { contentHash } from './hash.js';
import type { CaseResult, Verdict } from './runs.js';
export type ReviewReceipt = {
    schemaVersion: 1;
    id: string;
    runId: string;
    caseId?: string;
    scope?: string;
    resultHash: string;
    matrixHash: string;
    releaseId: string;
    executionEnvironmentRef?: ArtifactRef;
    by: PersonRef;
    at: string;
    checksReviewed: string[];
    verdict: Verdict;
    rationale: string;
    evidenceRef: ArtifactRef;
};
export function validateReview(value: unknown, context: {
    runId: string;
    result: CaseResult;
    matrixHash: string;
    releaseId: string;
}): ReviewReceipt {
    const o = object(value, ['schemaVersion', 'id', 'runId', 'caseId', 'scope', 'resultHash', 'matrixHash', 'releaseId', 'executionEnvironmentRef', 'by', 'at', 'checksReviewed', 'verdict', 'rationale', 'evidenceRef'], ['schemaVersion', 'id', 'runId', 'resultHash', 'matrixHash', 'releaseId', 'by', 'at', 'checksReviewed', 'verdict', 'rationale', 'evidenceRef']);
    version(o.schemaVersion);
    id(o.id);
    id(o.runId);
    sha(o.resultHash);
    sha(o.matrixHash);
    id(o.releaseId);
    person(o.by);
    instant(o.at);
    enumeration(o.verdict, ['pass', 'fail', 'pending']);
    text(o.rationale);
    ref(o.evidenceRef);
    if ((o.caseId === undefined) === (o.scope === undefined))
        fail('review_case_or_scope');
    if (o.caseId !== undefined)
        id(o.caseId);
    else {
        id(o.scope);
        if (o.scope !== 'case:' + context.result.caseId)
            fail('review_scope');
    }
    const checks = list(o.checksReviewed, 1).map(id);
    unique(checks, c => c);
    if (o.runId !== context.runId || o.caseId !== undefined && o.caseId !== context.result.caseId || o.resultHash !== contentHash(context.result) || o.matrixHash !== context.matrixHash || o.releaseId !== context.releaseId)
        fail('review_identity');
    if (Date.parse(String(o.at)) < Date.parse(context.result.finishedAt) || Date.parse(String(o.at)) > Date.now())
        fail('review_time');
    if (checks.some(c => !context.result.manualChecksRequired.includes(c)))
        fail('review_check');
    if (o.executionEnvironmentRef !== undefined) {
        ref(o.executionEnvironmentRef);
        if (!context.result.executionEnvironmentRef || contentHash(o.executionEnvironmentRef) !== contentHash(context.result.executionEnvironmentRef))
            fail('review_environment');
    }
    if (checks.some(c => /device|reader|lector|dispositivo/i.test(c)) && !o.executionEnvironmentRef)
        fail('review_environment');
    return o as unknown as ReviewReceipt;
}
/** Receipts are validated with context and evidence before deriving. Fail always dominates. */
export function deriveResult(raw: CaseResult, reviews: ReviewReceipt[]): Verdict {
    if (raw.automaticVerdict === 'fail' || raw.checks.some(c => c.status === 'fail') || reviews.some(r => r.verdict === 'fail'))
        return 'fail';
    if (raw.automaticVerdict === 'pending' || raw.checks.some(c => c.status === 'pending'))
        return 'pending';
    for (const check of raw.manualChecksRequired) {
        const relevant = reviews.filter(r => r.checksReviewed.includes(check));
        if (!relevant.length || relevant.some(r => r.verdict !== 'pass'))
            return 'pending';
    }
    return 'pass';
}
export type EvaluatedResult = {
    runId: string;
    caseId: string;
    rawResultRef: ArtifactRef;
    reviewRefs: ArtifactRef[];
    finalVerdict: Verdict;
    derivedAt: string;
    reasons: string[];
};
