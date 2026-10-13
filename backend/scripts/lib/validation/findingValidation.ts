import { findingEvent, validateFinding, states, type Finding, type FindingState } from './findings.js';
import { validateRun } from './runs.js';
import type { MatrixC3 } from './matrixC3.js';
import type { MatrixC4 } from './matrixC4.js';
import type { Run, Verdict } from './runs.js';
import { contentHash } from './hash.js';
import { fail, type ArtifactRef } from './types.js';
export type FindingProof = {
    matrix: MatrixC3 | MatrixC4;
    runs: {
        run: Run;
        ref: ArtifactRef;
        verdicts: ReadonlyMap<string, Verdict>;
    }[];
    enabledModels: string[];
    adjustmentReleaseRef: ArtifactRef;
};
export function transitionFinding(value: Finding, next: FindingState, eventValue: unknown, proof?: FindingProof): Finding {
    const f = validateFinding(value), event = findingEvent(eventValue);
    if (event.from !== f.status || event.to !== next || Date.parse(event.at) < Date.parse(f.events.at(-1)!.at) || f.events.some(e => e.id === event.id))
        fail('transition_event');
    const normal = states.indexOf(next) === states.indexOf(f.status) + 1;
    const reopen = next === 'En análisis' && states.indexOf(f.status) >= 2;
    if (!normal && !reopen)
        fail('finding_transition');
    const refs = [...f.validationRunRefs];
    if (next === 'Validada' || next === 'Cerrada') {
        if (!proof || !proof.runs.length || contentHash(f.matrixRef) !== contentHash(proof.runs[0].run.matrixRef))
            fail('finding_validation_pending');
        const adjustment = f.events.filter(e => e.to === 'Ajustada').at(-1);
        if (!adjustment?.adjustmentRef)
            fail('finding_adjustment');
        for (const item of proof.runs) {
            validateRun(item.run, proof.matrix);
            if (contentHash(item.run.matrixRef) !== contentHash(f.matrixRef))
                fail('finding_matrix');
            if (item.run.status !== 'complete' || !item.run.finishedAt || Date.parse(item.run.finishedAt) > Date.parse(event.at) || Date.parse(item.run.startedAt) <= Date.parse(adjustment.at) || contentHash(item.run.releaseRef) !== contentHash(proof.adjustmentReleaseRef) || !item.run.caseResults.some(c => c.caseId === f.caseId) || item.verdicts.get(f.caseId) !== 'pass')
                fail('finding_validation');
        }
        if (f.evaluatedModel !== undefined) {
            for (const model of proof.enabledModels)
                if (!proof.runs.some(r => r.run.mode === 'independent' && r.run.targetModel === model))
                    fail('finding_all_models');
            if (proof.enabledModels.length !== 2)
                fail('finding_all_models');
        }
        else if (!proof.runs.some(r => r.run.suite === 'c4' && r.run.mode === 'functional' && r.run.caseResults.some(c => c.caseId === f.caseId && c.environment === f.environment)))
            fail('finding_functional_validation');
        for (const r of proof.runs.map(r => r.ref))
            if (!refs.some(x => contentHash(x) === contentHash(r)))
                refs.push(r);
    }
    return validateFinding({ ...f, status: next, events: [...f.events, event], validationRunRefs: refs });
}
export function assertFindingCoverage(runs: Run[], verdicts: ReadonlyMap<string, ReadonlyMap<string, Verdict>>, findings: Finding[]): void {
    for (const run of runs)
        for (const result of run.caseResults)
            if (verdicts.get(run.runId)?.get(result.caseId) !== 'pass' && !findings.some(f => f.originRunId === run.runId && f.caseId === result.caseId && (run.suite === 'c3' ? f.evaluatedModel === (run.targetModel ?? result.attempts.find(a => a.status === 'success')?.effectiveModel ?? null) : f.environment === result.environment)))
                fail('finding_missing', result.caseId);
}
