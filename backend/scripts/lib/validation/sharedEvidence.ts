import { object, version, id, ref, list, text, enumeration, instant, finite, person, sha, fail, type ArtifactRef } from './types.js';
import { jsonArtifact, readArtifact } from './artifacts.js';
import { contentHash } from './hash.js';
import { auditWave, checkWaveAudit, summarize, bogotaDay, type Sample } from '../loadRunner.js';
import { executionEnvironment, assertRealEnvironment } from './environments.js';
export const uiStates = ['closed', 'first-load', 'opening', 'consent-pending', 'consent-authorized', 'consent-anonymous', 'creating-id', 'creating-id-failed', 'categories', 'emergency-contacts', 'emergency-no-contacts', 'empty-list', 'waiting', 'reduced-motion', 'success-prose', 'success-list', 'success-table', 'success-links', 'success-sources', 'failure-retryable', 'failure-nonretryable', 'failure-no-contacts', 'retries-exhausted', 'restart-dialog', 'restart-cancelled', 'rating-available', 'rating-reason', 'rating-sending', 'rating-confirmed', 'rating-failed', 'response-no-id'] as const;
export const manualCriteria = ['names-roles', 'focus-order', 'tab-shift-tab', 'escape', 'live-status', 'table-headings', 'link-announcement', 'zoom-reflow', 'mobile-modal-inert', 'map-control', 'confirmation', 'virtual-keyboard', 'safe-areas', 'orientation'] as const;
export function validateLoadResults(values: unknown[]): {
    total: number;
    authorized: number;
    anonymous: number;
    days: string[];
    p95: number[];
} {
    const waves: Sample[][] = [];
    for (const v of values) {
        const o = v as Record<string, unknown>;
        if (o.modo !== 'waves')
            fail('load_owner_format');
        const samples = list(o.muestras, 1);
        const groups = new Map<string, Sample[]>();
        for (const raw of samples) {
            const s = raw as Sample;
            if (typeof s.id !== 'string' || !/^W[1-6]-/.test(s.id) || !Number.isFinite(s.inicioMs) || !Number.isFinite(s.ms) || s.ms < 0 || s.status !== 200 || s.ok !== true || typeof s.autorizada !== 'boolean' || s.autorizada !== (s.grupo === 'autorizada'))
                fail('load_sample');
            const key = s.id.split('-')[0];
            const group = groups.get(key) ?? [];
            group.push(s);
            groups.set(key, group);
        }
        waves.push(...groups.values());
    }
    if (waves.length !== 6)
        fail('load_six_waves');
    waves.sort((a, b) => Math.min(...a.map(s => s.inicioMs)) - Math.min(...b.map(s => s.inicioMs)));
    const days = new Set<string>();
    const p95: number[] = [];
    let lastEnd = -Infinity;
    const responseIds = new Set<string>();
    for (const wave of waves) {
        if (checkWaveAudit(auditWave(wave)).length)
            fail('load_composition');
        const ids = new Set(wave.map(s => s.id));
        if (ids.size !== 25)
            fail('load_duplicate');
        for (let i = 0; i < 5; i++)
            if (wave.filter(s => s.grupo === 'autorizada' && s.conversacion === i).length !== 3)
                fail('load_conversation_three');
        for (const s of wave.filter(s => s.autorizada)) {
            if (!s.responseId || responseIds.has(s.responseId))
                fail('load_response_duplicate');
            responseIds.add(s.responseId);
        }
        const start = Math.min(...wave.map(s => s.inicioMs)), end = Math.max(...wave.map(s => s.inicioMs + s.ms));
        const localDays = new Set(wave.map(s => bogotaDay(new Date(s.inicioMs))));
        if (localDays.size !== 1 || start - lastEnd < 120000)
            fail('load_gap_or_day');
        days.add([...localDays][0]);
        lastEnd = end;
        const summary = summarize(wave);
        if (summary.errores || summary.p95 > 20000 || summary.superan40s)
            fail('load_latency');
        p95.push(summary.p95);
    }
    if (days.size !== 2)
        fail('load_two_days');
    return { total: 150, authorized: 90, anonymous: 60, days: [...days], p95 };
}
export function validateUiResults(value: unknown): void {
    const o = object(value, ['states', 'manual', 'contrast', 'zoomPercent', 'readers']);
    const rows = list(o.states, 1).map(v => object(v, ['state', 'context', 'violations']));
    for (const row of rows) {
        enumeration(row.state, uiStates);
        enumeration(row.context, ['host', 'shell', 'iframe']);
        if (list(row.violations).length)
            fail('axe_violations');
    }
    for (const state of uiStates)
        for (const context of ['host', 'shell', 'iframe'])
            if (rows.filter(r => r.state === state && r.context === context).length !== 1)
                fail('axe_state_context');
    const checks = list(o.manual, 1).map(v => object(v, ['criterion', 'environment', 'verdict', 'rationale']));
    for (const c of checks) {
        enumeration(c.criterion, manualCriteria);
        enumeration(c.environment, ['desktop', 'mobile']);
        enumeration(c.verdict, ['pass']);
        text(c.rationale);
    }
    for (const c of manualCriteria)
        for (const e of ['desktop', 'mobile'])
            if (checks.filter(r => r.criterion === c && r.environment === e).length !== 1)
                fail('manual_coverage');
    const contrast = object(o.contrast, ['normalText', 'largeText', 'controls']);
    if (finite(contrast.normalText) < 4.5 || finite(contrast.largeText) < 3 || finite(contrast.controls) < 3 || finite(o.zoomPercent) < 200)
        fail('contrast_zoom');
    const readers = list(o.readers, 2).map(v => { const r = object(v, ['environment', 'name', 'version']); enumeration(r.environment, ['desktop', 'mobile']); text(r.name); text(r.version); return r; });
    if (!['desktop', 'mobile'].every(e => readers.some(r => r.environment === e)))
        fail('readers');
}
export type SharedVerification = {
    schemaVersion: 1;
    id: string;
    requirementId: 'RNF-C4-UI-02' | 'RNF-C3-IN-03';
    ownerSpec: '004' | '005';
    releaseRef: ArtifactRef;
    executedAt: string;
    reportRef: ArtifactRef;
    resultRefs: ArtifactRef[];
    manualReviewRefs: ArtifactRef[];
    verdict: 'pass' | 'fail' | 'pending';
    quantities: Record<string, unknown>;
};
export async function verifyShared(root: string, value: unknown, releaseRef: ArtifactRef): Promise<SharedVerification> {
    const o = object(value, ['schemaVersion', 'id', 'requirementId', 'ownerSpec', 'releaseRef', 'executedAt', 'reportRef', 'resultRefs', 'manualReviewRefs', 'verdict', 'quantities']);
    version(o.schemaVersion);
    id(o.id);
    instant(o.executedAt);
    enumeration(o.requirementId, ['RNF-C4-UI-02', 'RNF-C3-IN-03']);
    enumeration(o.verdict, ['pass', 'fail', 'pending']);
    const expected = o.requirementId === 'RNF-C4-UI-02' ? '004' : '005';
    if (o.ownerSpec !== expected || contentHash(ref(o.releaseRef)) !== contentHash(releaseRef))
        fail('shared_owner_release');
    await readArtifact(root, ref(o.reportRef));
    const resultRefs = list(o.resultRefs, 1).map(ref), manualRefs = list(o.manualReviewRefs, 1).map(ref);
    for (const r of [...resultRefs, ...manualRefs])
        await readArtifact(root, r);
    for (const r of manualRefs) {
        const receipt = object(await jsonArtifact(root, r), ['schemaVersion', 'id', 'resultHashes', 'releaseRef', 'by', 'at', 'verdict', 'rationale', 'evidenceRef']);
        version(receipt.schemaVersion);
        id(receipt.id);
        person(receipt.by);
        instant(receipt.at);
        text(receipt.rationale);
        if (receipt.verdict !== 'pass' || contentHash(receipt.releaseRef) !== contentHash(releaseRef) || Date.parse(String(receipt.at)) < Date.parse(String(o.executedAt)) || Date.parse(String(receipt.at)) > Date.now() || contentHash(list(receipt.resultHashes).map(sha).sort()) !== contentHash(resultRefs.map(r => r.sha256).sort()))
            fail('shared_manual_receipt');
        await readArtifact(root, ref(receipt.evidenceRef));
    }
    const q = object(o.quantities, ['ownerCaseId', 'executionEnvironmentRefs', 'rawResultRefs', 'reconciliationRef'], ['ownerCaseId', 'executionEnvironmentRefs', 'rawResultRefs']);
    if (q.ownerCaseId !== (expected === '004' ? 'N02' : 'N303'))
        fail('shared_owner_case');
    const envRefs = list(q.executionEnvironmentRefs, 1).map(ref);
    for (const r of envRefs) {
        const e = executionEnvironment(await jsonArtifact(root, r));
        await readArtifact(root, e.evidenceRef);
        assertRealEnvironment(e, expected === '004' ? 'mobile' : 'desktop', expected === '004');
    }
    for (const rawRef of list(q.rawResultRefs, 1).map(ref))
        if (!resultRefs.some(r => contentHash(r) === contentHash(rawRef)))
            fail('shared_raw_ref');
    if (expected === '004') {
        if (resultRefs.length !== 1 || envRefs.length < 2)
            fail('ui_evidence');
        validateUiResults(await jsonArtifact(root, resultRefs[0]));
    }
    else {
        validateLoadResults(await Promise.all(resultRefs.map(r => jsonArtifact(root, r))));
        const reconciliation = await jsonArtifact(root, ref(q.reconciliationRef)) as Record<string, unknown>;
        const aut = object(reconciliation.autorizados, ['esperados', 'encontrados', 'faltantes', 'incoherentes', 'duplicados']), anon = object(reconciliation.anonimos, ['esperados', 'emparejados', 'sinMuestra', 'faltantes', 'incompletos']);
        if (reconciliation.estado !== 'conforme' || aut.esperados !== 90 || aut.encontrados !== 90 || anon.esperados !== 60 || anon.emparejados !== 60 || [aut.faltantes, aut.incoherentes, aut.duplicados, anon.sinMuestra, anon.faltantes, anon.incompletos].some(n => n !== 0))
            fail('load_reconciliation');
    }
    return o as unknown as SharedVerification;
}
