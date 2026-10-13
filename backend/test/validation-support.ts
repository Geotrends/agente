/** Fixtures solo sintéticas. No son fuente oficial, aprobación ni recepción contractual. */
import type { MatrixC3, CaseC3, Direction } from '../scripts/lib/validation/matrixC3.js';
export const personFixture = { name: 'Persona sintética del arnés', role: 'Revisión sintética' };
export const refFixture = { path: 'fixture.json', sha256: 'a'.repeat(64), mediaType: 'application/json' };
export function c3Fixture(): MatrixC3 {
    const codes = ['GT-P-1', 'GT-P-2', 'GT-P-3', 'GT-P-4', 'GT-P-5', 'GT-P-6'];
    const ds: Direction[] = ['Ecosistemas', 'Gestión Ambiental', 'Bienestar Animal', 'Bienestar Animal', 'Bienestar Animal', 'Bienestar Animal'];
    const inventory = codes.map((code, i) => ({ code, direction: ds[i], documentVersion: '1', contentHash: 'a'.repeat(64) }));
    const c = (caseId: string, direction: Direction, type: CaseC3['expected']['type'], gtpCode?: string): CaseC3 => ({ id: caseId, direction, family: 'ordinary', question: 'Pregunta sintética ' + caseId, history: [], consent: 'anonymous', expected: { type, text: 'Expectativa sintética cotejable', keyFacts: { requirements: { applicable: false, value: null, rationale: 'No corresponde a un requisito factual en este fixture' }, deadlines: { applicable: false, value: null, rationale: 'No se evalúa plazo en este fixture' }, rules: { applicable: false, value: null, rationale: 'No se evalúa norma en este fixture' }, channel: { applicable: false, value: null, rationale: 'No se evalúa canal en este fixture' } }, citations: type === 'respondida' ? [gtpCode!] : [] }, sources: [{ code: gtpCode ?? 'RULE-1', version: '1', title: 'Documento sintético', url: 'https://fixture.invalid/source', contentHash: 'a'.repeat(64), sourceDate: '2026-10-09', dateKind: 'accessed', verifiedAt: '2026-10-10T00:00:00Z', verifiedBy: personFixture }], ...(gtpCode ? { gtpCode } : {}), author: personFixture, approvedAt: '2026-10-10T01:00:00Z', requirements: ['RF-C3-VA-01'] });
    const cases: CaseC3[] = inventory.flatMap(g => Array.from({ length: 3 }, (_, i) => c(g.code + '-' + i, g.direction, 'respondida', g.code)));
    const directions: Direction[] = ['Ecosistemas', 'Ecosistemas', 'Ecosistemas', 'Ecosistemas', 'Ecosistemas', 'Gestión Ambiental', 'Gestión Ambiental', 'Gestión Ambiental', 'Gestión Ambiental', 'Gestión Ambiental', 'Bienestar Animal', 'Bienestar Animal'];
    for (let i = 0; i < 12; i++)
        cases.push(c('ordinary-' + i, directions[i], (['sin información', 'fuera de alcance', 'aclaración'] as const)[Math.floor(i / 4)]));
    for (const surface of ['question', 'history', 'fragment'] as const)
        for (let i = 0; i < 3; i++) {
            const row = c('attack-' + surface + '-' + i, 'Ecosistemas', 'fuera de alcance');
            row.family = 'manipulation';
            row.requirements = ['RF-C3-VA-06'];
            row.attack = { surface, payloadRef: refFixture, ...(surface === 'fragment' ? { testDocumentRef: refFixture } : {}), expectedSafeguards: ['Conservar alcance', 'Conservar leyenda', 'No revelar prompt'] };
            if (surface === 'history') {
                row.consent = 'authorized';
                row.history = [{ pregunta: 'Ataque sintético', respuesta: 'Respuesta sintética' }];
            }
            cases.push(row);
        }
    return { schemaVersion: 1, id: 'fixture-c3', version: '1', kind: 'c3', createdAt: '2026-10-10T00:00:00Z', authors: [personFixture], baseRef: refFixture, gtpInventory: inventory, rulesRefs: [refFixture], cases, approval: { by: personFixture, at: '2026-10-10T02:00:00Z', humanEvidenceId: 'fixture-human-evidence' } };
}
export async function artifactFixture(root: string): Promise<{
    matrixRef: typeof refFixture;
    freezeRef: typeof refFixture;
    releaseRef: typeof refFixture;
    matrix: MatrixC3;
}> {
    const { writeImmutable } = await import('../scripts/lib/validation/artifacts.js');
    const { contentHash } = await import('../scripts/lib/validation/hash.js');
    const { freezeMatrix } = await import('../scripts/lib/validation/freeze.js');
    const fixture = await writeImmutable(root, 'fixture.json', { fixture: 'synthetic evidence; never real acceptance' });
    const m = c3Fixture();
    const baseRef = await writeImmutable(root, 'base.json', { schemaVersion: 1, gtpInventory: m.gtpInventory });
    m.baseRef = baseRef;
    m.rulesRefs = [fixture];
    for (const c of m.cases)
        if (c.attack) {
            c.attack.payloadRef = fixture;
            if (c.attack.testDocumentRef)
                c.attack.testDocumentRef = fixture;
        }
    const matrixRef = await writeImmutable(root, 'matrix.json', m);
    const approvalRef = await writeImmutable(root, 'approval.json', { schemaVersion: 1, id: 'fixture-approval', matrixRef, matrixContentHash: contentHash(m), approvedBy: personFixture, approvedAt: m.approval!.at, humanEvidenceRef: fixture });
    const freezeRef = await writeImmutable(root, 'freeze.json', await freezeMatrix(root, matrixRef, approvalRef, baseRef, personFixture, new Date('2026-10-10T03:00:00Z')));
    const files = [{ path: 'fixture-source.ts', sha256: fixture.sha256 }];
    const treeHash = contentHash(files);
    const treeManifestRef = await writeImmutable(root, 'tree.json', { schemaVersion: 1, files, treeHash });
    const h = 'a'.repeat(64);
    const identity = { gitCommit: 'a'.repeat(40), treeHash, backendImageDigest: 'sha256:' + h, frontendImageDigest: 'sha256:' + h, bundleHash: h, launcherHash: h, lockfiles: [fixture], promptHash: h, generationConfigHash: h, enabledModels: ['openai.gpt-oss-20b-1:0', 'openai.gpt-oss-120b-1:0'], baseRef, calibrationRef: fixture, contactsRevision: 'fixture-contacts', policyVersion: 'fixture-policy', tariffsHash: h, publicConfigHash: h };
    const environmentRef = await writeImmutable(root, 'environment.json', { schemaVersion: 1, id: 'fixture-environment', os: 'Linux fixture', osVersion: 'fixture-1', observedAt: '2026-10-10T04:00:00Z', executionClass: 'controlled', identity, evidenceRefs: [fixture] });
    const releaseRef = await writeImmutable(root, 'release.json', { schemaVersion: 1, releaseId: 'fixture-release', createdAt: '2026-10-10T05:00:00Z', treeManifestRef, ...identity, environmentRef, matrixRefs: [matrixRef] });
    return { matrixRef, freezeRef, releaseRef, matrix: m };
}
export function findingFixture() { return { schemaVersion: 1, id: 'finding-1', originRunId: 'run-1', caseId: 'case-1', matrixRef: refFixture, evaluatedModel: 'openai.gpt-oss-20b-1:0', description: 'Dato clave erróneo del fixture', priority: 'Crítica', failureType: 'Datos', causeRationale: 'La fuente sintética documenta un plazo distinto', owner: personFixture, estimatedAdjustmentDate: '2026-10-12', status: 'Registrada', requirementIds: ['RF-C3-VA-04'], previousFindingRefs: [], events: [{ id: 'registered', at: '2026-10-11T00:00:00Z', by: personFixture, from: null, to: 'Registrada', description: 'Registro sintético', evidenceRef: refFixture, priorityReview: { signals: ['key-fact-wrong'], by: personFixture, at: '2026-10-11T00:00:00Z', evidenceRef: refFixture } }], validationRunRefs: [] }; }
import type { Run } from '../scripts/lib/validation/runs.js';
export function runFixture(): Run { const m = c3Fixture(); return { schemaVersion: 1, runId: 'fixture-run', matrixRef: refFixture, freezeRef: refFixture, releaseRef: refFixture, suite: 'c3', mode: 'independent', adapter: 'double', targetModel: 'openai.gpt-oss-20b-1:0', startedAt: '2026-10-11T01:00:00Z', finishedAt: '2026-10-11T02:00:00Z', status: 'complete', caseResults: m.cases.map(c => ({ caseId: c.id, startedAt: '2026-10-11T01:00:00Z', finishedAt: '2026-10-11T01:01:00Z', observedRef: refFixture, evidenceRefs: [refFixture], checks: [{ id: 'type', status: 'pass', reason: 'Tipo observado' }], automaticVerdict: 'pass', manualChecksRequired: [], attempts: [{ attemptIndex: 1, requestedModel: 'openai.gpt-oss-20b-1:0', sentModel: 'openai.gpt-oss-20b-1:0', effectiveModel: 'openai.gpt-oss-20b-1:0', status: 'success', at: '2026-10-11T01:00:01Z', usage: { inputTokens: 10, outputTokens: 5 } }] })), cleanupRefs: [], artifacts: [refFixture] }; }
import { flows, type MatrixC4 } from '../scripts/lib/validation/matrixC4.js';
export function c4Fixture(): MatrixC4 {
    const c3 = c3Fixture();
    const cases = flows.flatMap(flow => ['desktop', 'mobile'].flatMap(environment => {
        const variants = flow === 'opening-consent' ? ['authorized', 'anonymous'] : flow === 'functional-limit' ? ['filing', 'decision'] : flow === 'c3-failure' ? ['unavailable', 'waiting'] : undefined;
        const rows = flow === 'opening-consent' ? variants!.map(v => [v]) : flow === 'faq' ? c3.gtpInventory.slice(0, 3).map(g => [g.code]) : [variants ?? []];
        return rows.map((v, i) => ({ id: flow + '-' + environment + '-' + i, flow, environment, steps: ['Ejecutar el flujo completo y verificar sus controles'], expected: 'Resultado sintético cotejable del flujo', requirements: ['RF-C4-PR-01'], author: personFixture, approvedAt: '2026-10-10T04:00:00Z', runnerCase: flow, ...(flow === 'faq' ? { c3CaseId: c3.cases.find(c => c.gtpCode === v[0])!.id, direction: c3.gtpInventory.find(g => g.code === v[0])!.direction } : { variants: v }) }));
    }));
    return { schemaVersion: 1, id: 'fixture-c4', version: '1', kind: 'c4', createdAt: '2026-10-10T00:00:00Z', authors: [personFixture], c3MatrixRef: refFixture, cases: cases as MatrixC4['cases'], approval: { by: personFixture, at: '2026-10-10T05:00:00Z', humanEvidenceId: 'fixture-approval' } };
}
export function c4RunFixture(): Run { const r = runFixture(); const m = c4Fixture(); delete r.targetModel; r.suite = 'c4'; r.mode = 'functional'; r.caseResults = m.cases.map(c => ({ ...r.caseResults[0], caseId: c.id, environment: c.environment, executionEnvironmentRef: refFixture, attempts: [] })); return r; }
