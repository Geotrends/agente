import { object, version, id, instant, person, ref, list, text, enumeration, requirement, unique, fail, type ArtifactRef, type PersonRef } from './types.js';
import { approval, directions, type MatrixApproval, type MatrixC3, type Direction } from './matrixC3.js';
export const flows = ['opening-consent', 'category', 'faq', 'emergency', 'functional-limit', 'c3-failure', 'rating', 'new-conversation'] as const;
export type Flow = typeof flows[number];
export type CaseC4 = {
    id: string;
    flow: Flow;
    environment: 'desktop' | 'mobile';
    steps: string[];
    expected: string;
    requirements: string[];
    author: PersonRef;
    approvedAt: string | null;
    sourceCaseIds?: string[];
    c3CaseId?: string;
    direction?: Direction;
    runnerCase: Flow;
    variants?: string[];
};
export type MatrixC4 = {
    schemaVersion: 1;
    id: string;
    version: string;
    kind: 'c4';
    createdAt: string;
    authors: PersonRef[];
    c3MatrixRef: ArtifactRef;
    cases: CaseC4[];
    approval: MatrixApproval | null;
};
const variants: Partial<Record<Flow, string[]>> = { 'opening-consent': ['authorized', 'anonymous'], 'category': ['ecosystems', 'animal', 'environment', 'uncertain'], 'functional-limit': ['filing', 'decision'], 'c3-failure': ['unavailable', 'waiting'], 'rating': ['authorized', 'anonymous'], 'new-conversation': ['confirmed', 'cancelled'] };
export function matrixC4(value: unknown, c3: MatrixC3, candidate = true): MatrixC4 {
    const o = object(value, ['schemaVersion', 'id', 'version', 'kind', 'createdAt', 'authors', 'c3MatrixRef', 'cases', 'approval'], ['schemaVersion', 'id', 'version', 'kind', 'createdAt', 'authors', 'c3MatrixRef', 'cases']);
    version(o.schemaVersion);
    id(o.id);
    id(o.version);
    enumeration(o.kind, ['c4']);
    instant(o.createdAt);
    list(o.authors, 1).forEach(person);
    ref(o.c3MatrixRef);
    approval(o.approval ?? null, candidate);
    const cases = list(o.cases, 1).map(v => {
        const c = object(v, ['id', 'flow', 'environment', 'steps', 'expected', 'requirements', 'author', 'approvedAt', 'sourceCaseIds', 'c3CaseId', 'direction', 'runnerCase', 'variants'], ['id', 'flow', 'environment', 'steps', 'expected', 'requirements', 'author', 'runnerCase']);
        id(c.id);
        const flow = enumeration(c.flow, flows);
        enumeration(c.environment, ['desktop', 'mobile']);
        list(c.steps, 1).forEach(text);
        text(c.expected);
        list(c.requirements, 1).forEach(v => requirement(v));
        person(c.author);
        if (c.approvedAt !== undefined && c.approvedAt !== null)
            instant(c.approvedAt);
        else if (!candidate)
            fail('case_approval');
        if (c.sourceCaseIds !== undefined) {
            const source = list(c.sourceCaseIds).map(id);
            unique(source, x => x);
        }
        if (c.runnerCase !== flow)
            fail('runner_case');
        if (c.variants !== undefined) {
            const values = list(c.variants).map(text);
            unique(values, x => x);
            if (values.some(v => !variants[flow]?.includes(v)))
                fail('runner_variant');
        }
        if (flow === 'faq') {
            id(c.c3CaseId);
            enumeration(c.direction, directions);
            const source = c3.cases.find(s => s.id === c.c3CaseId);
            if (!source || source.expected.type !== 'respondida' || source.direction !== c.direction)
                fail('faq_c3_case');
        }
        else if (c.c3CaseId !== undefined || c.direction !== undefined)
            fail('nonfaq_c3_case');
        return c as unknown as CaseC4;
    });
    unique(cases, c => c.id);
    if (o.approval) {
        const a = o.approval as MatrixApproval;
        if (Date.parse(a.at) < Date.parse(String(o.createdAt)) || cases.some(c => !c.approvedAt || Date.parse(c.approvedAt) > Date.parse(a.at)))
            fail('matrix_approval_order');
    }
    return o as unknown as MatrixC4;
}
export function coverageC4(m: MatrixC4): {
    total: number;
    byFlow: Record<string, number>;
} {
    const byFlow: Record<string, number> = {};
    if (m.cases.length < 20)
        fail('coverage_c4_total');
    for (const flow of flows) {
        const rows = m.cases.filter(c => c.flow === flow);
        byFlow[flow] = rows.length;
        if (rows.length < 2 || !['desktop', 'mobile'].every(e => rows.some(c => c.environment === e)))
            fail('coverage_c4_flow', flow);
        for (const env of ['desktop', 'mobile']) {
            const envRows = rows.filter(c => c.environment === env);
            if (flow === 'faq' && !directions.every(d => envRows.some(c => c.direction === d)))
                fail('coverage_c4_faq');
            const required = flow === 'opening-consent' ? ['authorized', 'anonymous'] : flow === 'functional-limit' ? ['filing', 'decision'] : flow === 'c3-failure' ? ['unavailable', 'waiting'] : [];
            if (required.some(v => !envRows.some(c => c.variants?.includes(v))))
                fail('coverage_c4_variants', flow);
        }
    }
    return { total: m.cases.length, byFlow };
}
