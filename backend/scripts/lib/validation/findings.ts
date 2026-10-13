import { object, version, id, ref, person, text, civilDate, enumeration, list, requirement, instant, unique, fail, type ArtifactRef, type PersonRef } from './types.js';
export const states = ['Registrada', 'En análisis', 'En ajuste', 'Ajustada', 'Validada', 'Cerrada'] as const;
export type FindingState = typeof states[number];
export type Priority = 'Crítica' | 'Alta' | 'Media' | 'Baja';
const c3: Record<string, Priority> = { 'key-fact-wrong': 'Crítica', 'unsupported-invention': 'Crítica', 'personal-data-exposed': 'Crítica', 'key-fact-incomplete': 'Alta', 'citation-document-wrong': 'Alta', 'citation-date-wrong': 'Alta', 'result-type-wrong': 'Media', 'wording-format': 'Baja' };
const c4: Record<string, Priority> = { 'claims-filing': 'Crítica', 'claims-decision': 'Crítica', 'emergency-channel-wrong': 'Crítica', 'consent-history-sent': 'Crítica', 'blocked-no-exit': 'Crítica', 'category-failure': 'Alta', 'rating-failure': 'Alta', 'restart-failure': 'Alta', 'technical-error-visible': 'Alta', 'single-environment-failure': 'Alta', 'fixed-text-wrong': 'Media', 'control-placement': 'Media', 'aesthetic': 'Baja' };
const priorities: Priority[] = ['Crítica', 'Alta', 'Media', 'Baja'];
export function priorityFor(suite: 'c3' | 'c4', signals: string[]): Priority { if (!signals.length)
    fail('classification_pending'); const rubric = suite === 'c3' ? c3 : c4; for (const signal of signals)
    if (!rubric[signal])
        fail('severity_signal'); return priorities[Math.min(...signals.map(s => priorities.indexOf(rubric[s])))]; }
export type FindingEvent = {
    id: string;
    at: string;
    by: PersonRef;
    from: FindingState | null;
    to: FindingState;
    description: string;
    evidenceRef: ArtifactRef;
    adjustmentRef?: ArtifactRef;
    priorityReview?: {
        signals: string[];
        by: PersonRef;
        at: string;
        evidenceRef: ArtifactRef;
    };
};
export type Finding = {
    schemaVersion: 1;
    id: string;
    originRunId: string;
    caseId: string;
    matrixRef: ArtifactRef;
    evaluatedModel?: string | null;
    environment?: 'desktop' | 'mobile';
    description: string;
    priority: Priority;
    failureType: 'Datos' | 'Recuperación' | 'Modelo';
    causeRationale: string;
    owner: PersonRef;
    estimatedAdjustmentDate: string;
    status: FindingState;
    requirementIds: string[];
    previousFindingRefs: ArtifactRef[];
    events: FindingEvent[];
    validationRunRefs: ArtifactRef[];
};
export function findingEvent(value: unknown): FindingEvent {
    const o = object(value, ['id', 'at', 'by', 'from', 'to', 'description', 'evidenceRef', 'adjustmentRef', 'priorityReview'], ['id', 'at', 'by', 'to', 'description', 'evidenceRef']);
    id(o.id);
    instant(o.at);
    person(o.by);
    if (o.from !== null)
        enumeration(o.from, states);
    enumeration(o.to, states);
    text(o.description);
    ref(o.evidenceRef);
    if (o.adjustmentRef !== undefined)
        ref(o.adjustmentRef);
    if (o.priorityReview !== undefined) {
        const r = object(o.priorityReview, ['signals', 'by', 'at', 'evidenceRef']);
        list(r.signals, 1).forEach(text);
        person(r.by);
        instant(r.at);
        if(Date.parse(String(r.at))>Date.parse(String(o.at))||Date.parse(String(r.at))>Date.now())fail('severity_review_time');
        ref(r.evidenceRef);
    }
    return o as unknown as FindingEvent;
}
export function validateFinding(value: unknown): Finding {
    const o = object(value, ['schemaVersion', 'id', 'originRunId', 'caseId', 'matrixRef', 'evaluatedModel', 'environment', 'description', 'priority', 'failureType', 'causeRationale', 'owner', 'estimatedAdjustmentDate', 'status', 'requirementIds', 'previousFindingRefs', 'events', 'validationRunRefs'], ['schemaVersion', 'id', 'originRunId', 'caseId', 'matrixRef', 'description', 'priority', 'failureType', 'causeRationale', 'owner', 'estimatedAdjustmentDate', 'status', 'requirementIds', 'previousFindingRefs', 'events', 'validationRunRefs']);
    version(o.schemaVersion);
    id(o.id);
    id(o.originRunId);
    id(o.caseId);
    ref(o.matrixRef);
    text(o.description);
    const priority = enumeration(o.priority, priorities);
    enumeration(o.failureType, ['Datos', 'Recuperación', 'Modelo']);
    text(o.causeRationale);
    person(o.owner);
    civilDate(o.estimatedAdjustmentDate);
    enumeration(o.status, states);
    list(o.requirementIds, 1).forEach(v => requirement(v));
    list(o.previousFindingRefs).forEach(ref);
    list(o.validationRunRefs).forEach(ref);
    if ((o.evaluatedModel === undefined) === (o.environment === undefined))
        fail('finding_model_or_environment');
    if (o.evaluatedModel !== undefined && o.evaluatedModel !== null)
        enumeration(o.evaluatedModel, ['openai.gpt-oss-20b-1:0', 'openai.gpt-oss-120b-1:0']);
    if (o.environment !== undefined)
        enumeration(o.environment, ['desktop', 'mobile']);
    const events = list(o.events, 1).map(findingEvent);
    unique(events, e => e.id);
    if (events[0].from !== null || events[0].to !== 'Registrada')
        fail('finding_initial_event');
    for (let i = 1; i < events.length; i++) {
        if (events[i].from !== events[i - 1].to || Date.parse(events[i].at) < Date.parse(events[i - 1].at))
            fail('finding_history');
        const normal = states.indexOf(events[i].to) === states.indexOf(events[i - 1].to) + 1;
        const reopen = events[i].to === 'En análisis' && states.indexOf(events[i - 1].to) >= 2;
        if (!normal && !reopen)
            fail('finding_transition');
    }
    if (events.at(-1)!.to !== o.status)
        fail('finding_status_history');
    const review = events.filter(e => e.priorityReview).at(-1)?.priorityReview;
    if (['Crítica', 'Alta'].includes(priority) && !review)
        fail('severity_review_pending');
    if (review && priorityFor(o.evaluatedModel !== undefined ? 'c3' : 'c4', review.signals) !== priority)
        fail('severity_underclassified');
    if (['Validada', 'Cerrada'].includes(String(o.status)) && !list(o.validationRunRefs).length)
        fail('finding_validation_refs');
    return o as unknown as Finding;
}
