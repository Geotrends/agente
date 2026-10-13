import { loadEvaluation } from './loadEvaluation.js';
import { evaluateRun } from './evaluation.js';
import { writeImmutable, readLedger } from './artifacts.js';
import { resolve, relative } from 'node:path';
import { safePath } from './artifacts.js';
import { kbPool } from '../../../src/kb/db.js';
import { procesarInforme } from '../../../src/kb/sync.js';
import { publicar } from '../../../src/kb/service.js';
import { AttackBase, kbAttackPorts, type AttackScope } from './attackBase.js';
import { person, list, ref } from './types.js';
import { qdrant, aliasKb } from '../../../src/services/qdrant.js';
import { sanitizeFragment } from '../../../src/services/pii.js';
import { artifact, jsonArtifact, readArtifact } from './artifacts.js';
import { argumentsFor } from '../../validation.js';
import { object, version, enumeration, text, sha, instant, fail } from './types.js';
import { contentHash, bytesHash } from './hash.js';
import { produceValidationEvidence } from '../diRunner.js';
import { verifyRelease, treeManifest } from './identity.js';
import { matrixC3, type CaseC3 } from './matrixC3.js';
import { handleChat, type ChatResult } from '../../../src/chat/handleChat.js';
import { productionDeps } from '../../../src/chat/runtime.js';
import { bedrockClient } from '../../../src/bedrock/client.js';
import { observeBedrock, type Attempt } from './invocations.js';
import { independentPolicy } from './modelPolicy.js';
import type { Deadline } from '../../../src/chat/deadline.js';
import { createConversation } from '../../../src/chat/conversations.js';
import { setting } from '../../../src/services/settings.js';
import { prepareIndex } from '../../../src/services/search.js';
import { validateDiConfig } from '../../../src/services/diConfig.js';
import type { VaObservation } from './vaRunner.js';
export async function validationCommand(args: string[]): Promise<number> {
    const a = argumentsFor(args, ['suite', 'mode', 'models', 'matrix', 'freeze', 'release', 'base-url', 'origin', 'adapter', 'output', 'root', 'source-root', 'observations', 'attack-manifest', 'evaluate-run', 'reviews']);
    for (const k of ['suite', 'mode', 'matrix', 'freeze', 'release', 'adapter', 'output', 'root', 'source-root'])
        if (!a.has(k))
            fail('arguments', k, 2);
    enumeration(a.get('suite'), ['va']);
    const mode = enumeration(a.get('mode'), ['integrated', 'independent']);
    const adapter = enumeration(a.get('adapter'), ['aws', 'double']);
    const root = resolve(a.get('root')!);
    if (resolve(a.get('output')!) !== root)
        fail('output_must_be_evidence_root', '', 2);
    const matrixRef = await artifact(root, a.get('matrix')!, 'application/json'), freezeRef = await artifact(root, a.get('freeze')!, 'application/json'), releaseRef = await artifact(root, a.get('release')!, 'application/json');
    const release = await verifyRelease(root, await jsonArtifact(root, releaseRef));
    const matrix = matrixC3(await jsonArtifact(root, matrixRef), false);
    const sourceRoot = resolve(a.get('source-root')!);
    const actual = await treeManifest(sourceRoot);
    if (actual.treeHash !== release.treeHash)
        fail('runtime_tree_identity', '', 2);
    if (a.has('evaluate-run')) {
        if (!a.has('reviews'))
            fail('reviews_required', '', 2);
        const reviewList = list(await jsonArtifact(root, await artifact(root, a.get('reviews')!, 'application/json'))).map(ref);
        const loaded = await loadEvaluation(root, await artifact(root, a.get('evaluate-run')!, 'application/json'), reviewList);
        if (contentHash(loaded.run.matrixRef) !== contentHash(matrixRef) || contentHash(loaded.run.releaseRef) !== contentHash(releaseRef) || loaded.run.mode !== mode || loaded.run.adapter !== adapter)
            fail('evaluation_run_identity');
        for (const event of await readLedger(root, 'events')) {
            if (Array.isArray(event.invalidatedRunIds) && event.invalidatedRunIds.includes(loaded.run.runId)) fail('evaluation_invalidated');
            if (event.runRef && event.runId !== loaded.run.runId && typeof event.at === 'string' && Date.parse(event.at) >= Date.parse(loaded.run.startedAt)) {
                const candidate = await jsonArtifact(root, ref(event.runRef)) as Record<string, unknown>;
                if (contentHash(candidate.matrixRef) === contentHash(matrixRef) && candidate.mode === mode && candidate.targetModel === loaded.run.targetModel) fail('evaluation_newer_run_exists');
            }
        }
        const env = await jsonArtifact(root, release.environmentRef) as {
            executionClass: string;
        };
        const summary = evaluateRun(loaded.run, loaded.matrix, loaded.verdicts, env.executionClass === 'real');
        await writeImmutable(root, `evaluations/${loaded.run.runId}-${Date.now()}.json`, { runRef: loaded.runRef, reviewRefs: reviewList, summary });
        return summary.realAcceptance ? 0 : 1;
    }
    if (adapter === 'aws' && validateDiConfig().length)
        fail('aws_server_role_configuration', '', 2);
    let attackManager: AttackBase | undefined;
    const attackDocuments = new Map<string, {
        documentKey: string;
        reportRef: import('./types.js').ArtifactRef;
        testDocumentRef: import('./types.js').ArtifactRef;
    }>();
    if (matrix.cases.some(c => c.attack?.surface === 'fragment')) {
        if (!a.get('attack-manifest'))
            fail('attack_environment_required', '', 2);
        const attackRef = await artifact(root, a.get('attack-manifest')!, 'application/json');
        const manifest = object(await jsonArtifact(root, attackRef), ['schemaVersion', 'scope', 'by', 'documentsRoot', 'cases']);
        version(manifest.schemaVersion);
        const scope = object(manifest.scope, ['databaseName', 'alias', 'officialAlias', 'baseRef', 'copyRef', 'syntheticOnly']) as unknown as AttackScope;
        if (contentHash(scope.baseRef) !== contentHash(matrix.baseRef))
            fail('attack_base_identity');
        await readArtifact(root, scope.copyRef);
        const documentsRoot = await safePath(root, text(manifest.documentsRoot));
        for (const entry of list(manifest.cases, 1)) {
            const e = object(entry, ['caseId', 'documentKey', 'reportRef', 'testDocumentRef']);
            const c = matrix.cases.find(c => c.id === e.caseId);
            if (!c?.attack || c.attack.surface !== 'fragment' || contentHash(c.attack.testDocumentRef) !== contentHash(e.testDocumentRef))
                fail('attack_case_reference');
            if (attackDocuments.has(String(e.caseId)))
                fail('duplicate_attack_case');
            const record = { documentKey: text(e.documentKey), reportRef: ref(e.reportRef), testDocumentRef: ref(e.testDocumentRef) };
            await readArtifact(root, record.testDocumentRef);
            const report = await jsonArtifact(root, record.reportRef) as {
                enlaces?: {
                    url?: string;
                    archivo?: string;
                    archivo_original?: unknown;
                }[];
            };
            if (report.enlaces?.length !== 1 || report.enlaces[0].url !== record.documentKey || report.enlaces[0].archivo !== relative(documentsRoot, resolve(root, record.testDocumentRef.path)) || report.enlaces[0].archivo_original)
                fail('attack_installation_report');
            attackDocuments.set(String(e.caseId), record);
        }
        const ports = await kbAttackPorts(kbPool(), scope, async (key) => { const d = [...attackDocuments.values()].find(d => d.documentKey === key); if (!d)
            fail('attack_document'); await procesarInforme(kbPool(), await safePath(root, d.reportRef.path), { raizDatos: documentsRoot }); const published = await publicar(kbPool(), { claves: [key] }, 'validation-offline'); if (!published.publicados.includes(key))
            fail('attack_publication'); });
        attackManager = new AttackBase(root, scope, ports, person(manifest.by));
        await attackManager.reconcile();
    }
    const snapshot = async () => ({ tree: (await treeManifest(sourceRoot)).treeHash, matrix: bytesHash(await readArtifact(root, matrixRef)), release: bytesHash(await readArtifact(root, releaseRef)), freeze: bytesHash(await readArtifact(root, freezeRef)) });
    const modes = mode === 'independent' ? (enumeration(a.get('models') ?? 'both', ['both', '20b', '120b']) === 'both' ? release.enabledModels : [release.enabledModels[a.get('models') === '120b' ? 1 : 0]]) : [undefined];
    let acceptance = true;
    if (mode === 'integrated' && a.has('models'))
        fail('integrated_models', '', 2);
    if (mode === 'independent')
        await prepareIndex();
    for (const targetModel of modes) {
        let attempts: Attempt[] = [];
        const execute = mode === 'independent' ? async (c: CaseC3, deadline: Deadline): Promise<VaObservation> => {
            attempts = [];
            let retrieved: import('../../../src/chat/sources.js').RetrievedHit[] = [];
            let exposedPointIds: string[] = [];
            const privacy = { promptLeak: false };
            const sender = adapter === 'aws' ? bedrockClient() : { send: async () => ({ output: { message: { content: [{ text: 'Orientación sintética [D1].\n<!--FUENTES: D1-->' }] } }, usage: { inputTokens: 100, outputTokens: 20 }, stopReason: 'end_turn' }) };
            const model = observeBedrock(sender, attempts, privacy);
            const prod = productionDeps();
            const deps = { ...prod, retrieve: async (q: string, cola?: string) => { const r = await prod.retrieve(q, cola); retrieved = r.hits; return r; } };
            const conversationId = c.consent === 'authorized' ? await createConversation('validation-offline', setting('consentPolicyVersion')) : undefined;
            const response = await handleChat({ pregunta: c.question, historial: c.history, ...(conversationId ? { conversationId } : {}), ...(c.category ? { categoria: c.category } : {}) }, 'validation-offline', { ...deps, adapter: model, modelCall: async (req, d) => { const result = await independentPolicy(model, targetModel!, release.enabledModels)(req, d); if (c.attack?.surface === 'fragment') {
                    const document = attackDocuments.get(c.id)!;
                    const relevant = retrieved.filter(h => h.sourceUrl === document.documentKey && req.system.includes(sanitizeFragment(h.snippet).texto));
                    if (relevant.length) {
                        const points = await qdrant().scroll(aliasKb(), { filter: { must: [{ key: 'url', match: { value: document.documentKey } }] }, with_payload: true, limit: 10000 });
                        exposedPointIds = points.points.filter(p => relevant.some(h => h.documentId === p.payload?.elemento_id)).map(p => String(p.id));
                    }
                } return result; } }, deadline);
            return { response, adapter, attempts, ...(!attempts.length ? { localReason: 'Decisión local de handleChat' } : {}), promptLeak: privacy.promptLeak, exposedPointIds };
        } : async (c: CaseC3, deadline: Deadline): Promise<VaObservation> => {
            if (!a.get('base-url') || !a.get('origin') || !a.get('observations'))
                fail('integrated_private_observation_required', '', 2);
            const base = new URL(a.get('base-url')!);
            const origin = new URL(a.get('origin')!);
            if (base.username || base.password || origin.username || origin.password || adapter === 'aws' && (base.protocol !== 'https:' || origin.protocol !== 'https:'))
                fail('https_target', '', 2);
            const headers: Record<string, string> = { 'content-type': 'application/json', origin: origin.origin };
            const session = await fetch(base.href.replace(/\/$/, '') + '/session', { method: 'POST', headers, signal: deadline.signal });
            const token = (await session.json() as {
                token?: unknown;
            }).token;
            text(token);
            headers.authorization = 'Bearer ' + token;
            let conversationId: string | undefined;
            if (c.consent === 'authorized') {
                const r = await fetch(base.href.replace(/\/$/, '') + '/conversations', { method: 'POST', headers, body: JSON.stringify({ autorizacion: true, policyVersion: release.policyVersion }), signal: deadline.signal });
                conversationId = String((await r.json() as {
                    conversationId?: unknown;
                }).conversationId);
                if (!r.ok)
                    fail('conversation_creation');
            }
            const http = await fetch(base.href.replace(/\/$/, '') + '/chat', { method: 'POST', headers, body: JSON.stringify({ pregunta: c.question, ...(conversationId ? { conversationId, historial: c.history } : {}), ...(c.category ? { categoria: c.category } : {}) }), signal: deadline.signal });
            const body = await http.json();
            const response = (http.status === 200 ? { status: 200, body } : { status: http.status, error: body.error }) as ChatResult;
            const file = relative(root, resolve(root, a.get('observations')!, c.id + '.json'));
            const reference = await artifact(root, file, 'application/json');
            const o = object(await jsonArtifact(root, reference), ['schemaVersion', 'id', 'releaseId', 'matrixContentHash', 'responseHash', 'startedAt', 'finishedAt', 'adapter', 'attempts', 'localReason', 'promptLeak', 'exposedPointIds'], ['schemaVersion', 'id', 'releaseId', 'matrixContentHash', 'responseHash', 'startedAt', 'finishedAt', 'adapter', 'attempts', 'promptLeak', 'exposedPointIds']);
            version(o.schemaVersion);
            instant(o.startedAt);
            instant(o.finishedAt);
            sha(o.responseHash);
            if (o.id !== c.id || o.releaseId !== release.releaseId || o.matrixContentHash !== contentHash(matrix) || o.responseHash !== contentHash(response) || o.adapter !== adapter || typeof o.promptLeak !== 'boolean')
                fail('private_observation_identity');
            attempts = o.attempts as Attempt[];
            return { response, adapter, attempts, ...(o.localReason ? { localReason: text(o.localReason) } : {}), promptLeak: o.promptLeak, exposedPointIds: o.exposedPointIds as string[] };
        };
        const result = await produceValidationEvidence({ root, matrixRef, freezeRef, releaseRef, mode, adapter, targetModel, execute, snapshot, attempts: () => attempts, ...(attackManager ? { attack: async (c: CaseC3, execute: () => Promise<VaObservation>) => { const document = attackDocuments.get(c.id); if (!document)
                    fail('attack_case_missing'); const r = await attackManager!.execute(document.documentKey, async (exposed) => { const observation = await execute(); exposed(observation.exposedPointIds); return observation; }); return { observation: r.result, cleanupRef: r.cleanupRef }; } } : {}) });
        console.log(`${result.run.runId}: ${result.run.caseResults.length} casos; ${result.summary.pending} pendientes; adapter=${adapter}`);
        acceptance &&= result.summary.realAcceptance;
    }
    return acceptance ? 0 : 1;
}
