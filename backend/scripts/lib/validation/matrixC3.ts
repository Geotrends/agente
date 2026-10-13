import { object, version, id, instant, person, ref, list, enumeration, text, sha, civilDate, requirement, unique, fail, type PersonRef, type ArtifactRef, type ResultType } from './types.js';
export const directions = ['Ecosistemas', 'Bienestar Animal', 'Gestión Ambiental'] as const;
export type Direction = typeof directions[number];
export type Gtp = {
    code: string;
    direction: Direction;
    documentVersion: string;
    contentHash: string;
};
export type FactExpectation = {
    applicable: boolean;
    value: string | null;
    rationale: string;
};
export type Source = {
    code: string;
    version: string;
    title: string;
    url: string;
    contentHash: string;
    sourceDate: string;
    dateKind: 'updated' | 'accessed';
    verifiedAt: string;
    verifiedBy: PersonRef;
};
export type CaseC3 = {
    id: string;
    direction: Direction;
    family: 'ordinary' | 'manipulation';
    question: string;
    history: {
        pregunta: string;
        respuesta: string;
    }[];
    consent: 'authorized' | 'anonymous';
    category?: Direction;
    expected: {
        type: ResultType;
        text: string;
        keyFacts: Record<'requirements' | 'deadlines' | 'rules' | 'channel', FactExpectation>;
        citations: string[];
    };
    sources: Source[];
    gtpCode?: string;
    author: PersonRef;
    approvedAt: string | null;
    approvalRef?: ArtifactRef;
    requirements: string[];
    attack?: {
        surface: 'question' | 'history' | 'fragment';
        payloadRef: ArtifactRef;
        testDocumentRef?: ArtifactRef;
        expectedSafeguards: string[];
    };
};
export type MatrixApproval = {
    by: PersonRef;
    at: string;
    humanEvidenceId: string;
};
export type MatrixC3 = {
    schemaVersion: 1;
    id: string;
    version: string;
    kind: 'c3';
    createdAt: string;
    authors: PersonRef[];
    baseRef: ArtifactRef;
    gtpInventory: Gtp[];
    rulesRefs: ArtifactRef[];
    cases: CaseC3[];
    approval: MatrixApproval | null;
};
export function approval(value: unknown, candidate: boolean): void { if (value === null && candidate)
    return; const a = object(value, ['by', 'at', 'humanEvidenceId']); person(a.by); instant(a.at); id(a.humanEvidenceId); }
export function inventory(value: unknown): Gtp[] { const values = list(value, 1).map(v => { const o = object(v, ['code', 'direction', 'documentVersion', 'contentHash']); id(o.code); if (!/^GT-P-/.test(String(o.code)))
    fail('gtp_code'); enumeration(o.direction, directions); text(o.documentVersion); sha(o.contentHash); return o as unknown as Gtp; }); unique(values, v => v.code); return values; }
function fact(value: unknown): void { const o = object(value, ['applicable', 'value', 'rationale'], ['applicable', 'rationale']); if (typeof o.applicable !== 'boolean')
    fail('fact_applicable'); text(o.rationale); if (o.applicable)
    text(o.value);
else if (o.value !== null)
    fail('fact_nonapplicable_value'); }
export function matrixC3(value: unknown, candidate = true): MatrixC3 {
    const o = object(value, ['schemaVersion', 'id', 'version', 'kind', 'createdAt', 'authors', 'baseRef', 'gtpInventory', 'rulesRefs', 'cases', 'approval'], ['schemaVersion', 'id', 'version', 'kind', 'createdAt', 'authors', 'baseRef', 'gtpInventory', 'rulesRefs', 'cases']);
    version(o.schemaVersion);
    id(o.id);
    id(o.version);
    enumeration(o.kind, ['c3']);
    instant(o.createdAt);
    list(o.authors, 1).forEach(person);
    ref(o.baseRef);
    const gtps = inventory(o.gtpInventory);
    list(o.rulesRefs, 1).forEach(ref);
    approval(o.approval ?? null, candidate);
    const cases = list(o.cases, 1).map(value => {
        const c = object(value, ['id', 'direction', 'family', 'question', 'history', 'consent', 'category', 'expected', 'sources', 'gtpCode', 'author', 'approvedAt', 'approvalRef', 'requirements', 'attack'], ['id', 'direction', 'family', 'question', 'history', 'consent', 'expected', 'sources', 'author', 'requirements']);
        id(c.id);
        enumeration(c.direction, directions);
        enumeration(c.family, ['ordinary', 'manipulation']);
        text(c.question);
        enumeration(c.consent, ['authorized', 'anonymous']);
        const history = list(c.history);
        if (c.consent === 'anonymous' && history.length)
            fail('anonymous_history', String(c.id));
        for (const pair of history) {
            const p = object(pair, ['pregunta', 'respuesta']);
            text(p.pregunta);
            text(p.respuesta);
        }
        if (c.category !== undefined)
            enumeration(c.category, directions);
        const e = object(c.expected, ['type', 'text', 'keyFacts', 'citations']);
        enumeration(e.type, ['respondida', 'sin información', 'fuera de alcance', 'aclaración']);
        text(e.text);
        const facts = object(e.keyFacts, ['requirements', 'deadlines', 'rules', 'channel']);
        Object.values(facts).forEach(fact);
        list(e.citations).forEach(text);
        const sources = list(c.sources, 1).map(v => { const s = object(v, ['code', 'version', 'title', 'url', 'contentHash', 'sourceDate', 'dateKind', 'verifiedAt', 'verifiedBy']); id(s.code); text(s.version); text(s.title); const url = new URL(text(s.url)); if (url.protocol !== 'https:' || url.username || url.password)
            fail('source_https'); sha(s.contentHash); civilDate(s.sourceDate); enumeration(s.dateKind, ['updated', 'accessed']); instant(s.verifiedAt); person(s.verifiedBy); if (Date.parse(String(s.sourceDate)) > Date.parse(String(s.verifiedAt)))
            fail('source_future'); return s as unknown as Source; });
        unique(sources, s => s.code);
        if (e.type === 'respondida') {
            if (!list(e.citations, 1).every(v => sources.some(s => s.code === v)))
                fail('citation_source');
        }
        if (c.family === 'ordinary' && e.type === 'respondida') {
            id(c.gtpCode);
            const g = gtps.find(g => g.code === c.gtpCode);
            if (!g || g.direction !== c.direction || !sources.some(s => s.code === g.code && s.version === g.documentVersion && s.contentHash === g.contentHash))
                fail('gtp_source', String(c.id));
        }
        if (c.gtpCode !== undefined && !gtps.some(g => g.code === c.gtpCode))
            fail('gtp_unknown');
        person(c.author);
        list(c.requirements, 1).forEach(v => requirement(v));
        if (c.approvedAt !== null && c.approvedAt !== undefined) {
            instant(c.approvedAt);
            if (sources.some(s => Date.parse(s.verifiedAt) > Date.parse(String(c.approvedAt))))
                fail('approval_before_verification');
        }
        else if (!candidate)
            fail('case_approval', String(c.id));
        if (c.approvalRef !== undefined)
            ref(c.approvalRef);
        if (c.family === 'manipulation') {
            const a = object(c.attack, ['surface', 'payloadRef', 'testDocumentRef', 'expectedSafeguards'], ['surface', 'payloadRef', 'expectedSafeguards']);
            enumeration(a.surface, ['question', 'history', 'fragment']);
            ref(a.payloadRef);
            list(a.expectedSafeguards, 1).forEach(text);
            if (a.surface === 'history' && (c.consent !== 'authorized' || !history.length))
                fail('history_attack');
            if (a.surface === 'fragment')
                ref(a.testDocumentRef);
        }
        else if (c.attack !== undefined)
            fail('ordinary_attack');
        return c as unknown as CaseC3;
    });
    unique(cases, c => c.id);
    if (o.approval) {
        const at = Date.parse(String((o.approval as MatrixApproval).at));
        if (at < Date.parse(String(o.createdAt)) || cases.some(c => !c.approvedAt || Date.parse(c.approvedAt) > at))
            fail('matrix_approval_order');
    }
    return o as unknown as MatrixC3;
}
