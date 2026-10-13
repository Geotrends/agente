/** VA artifacts around the existing chat case of use; no second generation engine. */
import { randomUUID } from 'node:crypto';
import type { ChatResult } from '../../../src/chat/handleChat.js';
import { assertPublicResponse } from '../../../src/chat/contracts.js';
import { Deadline } from '../../../src/chat/deadline.js';
import { abortable } from '../../../src/chat/modelRouting.js';
import { matrixC3, type CaseC3 } from './matrixC3.js';
import { jsonArtifact, writeImmutable, readArtifact } from './artifacts.js';
import { verifyFreeze } from './freeze.js';
import { verifyRelease } from './identity.js';
import { validateRun, checkpoint, type Run, type CaseResult, type Check } from './runs.js';
import { contentHash } from './hash.js';
import { evaluateRun, type Summary } from './evaluation.js';
import { fail, type ArtifactRef } from './types.js';
import type { Attempt } from './invocations.js';
export type VaObservation = {
    response: ChatResult;
    adapter: 'aws' | 'double';
    attempts: Attempt[];
    localReason?: string;
    promptLeak: boolean;
    exposedPointIds: string[];
};
export type VaOptions = {
    root: string;
    matrixRef: ArtifactRef;
    freezeRef: ArtifactRef;
    releaseRef: ArtifactRef;
    mode: 'integrated' | 'independent';
    adapter: 'aws' | 'double';
    targetModel?: string;
    execute: (c: CaseC3, deadline: Deadline) => Promise<VaObservation>;
    snapshot: () => Promise<unknown>;
    attempts?: () => Attempt[];
    attack?: (c: CaseC3, execute: () => Promise<VaObservation>) => Promise<{
        observation: VaObservation;
        cleanupRef: ArtifactRef;
    }>;
    signal?: AbortSignal;
};
export async function runVaMatrix(input: VaOptions): Promise<{
    run: Run;
    runRef: ArtifactRef;
    summary: Summary;
}> {
    const matrix = matrixC3(await jsonArtifact(input.root, input.matrixRef), false);
    const release = await verifyRelease(input.root, await jsonArtifact(input.root, input.releaseRef));
    if (!release.matrixRefs.some(r => contentHash(r) === contentHash(input.matrixRef)) || contentHash(release.baseRef) !== contentHash(matrix.baseRef))
        fail('release_matrix_or_base');
    if (input.mode === 'independent' && (!input.targetModel || !release.enabledModels.includes(input.targetModel)))
        fail('target_model');
    if (input.mode === 'integrated' && input.targetModel)
        fail('integrated_target');
    const startedAt = new Date().toISOString();
    await verifyFreeze(input.root, input.matrixRef, await jsonArtifact(input.root, input.freezeRef), new Date(startedAt));
    const initial = contentHash(await input.snapshot());
    const run: Run = { schemaVersion: 1, runId: 'va-' + randomUUID(), matrixRef: input.matrixRef, freezeRef: input.freezeRef, releaseRef: input.releaseRef, suite: 'c3', mode: input.mode, adapter: input.adapter, ...(input.targetModel ? { targetModel: input.targetModel } : {}), startedAt, finishedAt: null, status: 'running', caseResults: [], cleanupRefs: [], artifacts: [] };
    await checkpoint(input.root, run, matrix);
    for (const c of matrix.cases) {
        if (input.signal?.aborted) {
            run.status = 'interrupted';
            break;
        }
        const start = new Date().toISOString();
        const deadline = new Deadline();
        const cancel = () => deadline.context.abort(new Error('evaluation_cancelled'));
        input.signal?.addEventListener('abort', cancel, { once: true });
        let observation: VaObservation;
        const checks: Check[] = [];
        try {
            const execute = () => abortable(input.execute(c, deadline), deadline.signal);
            if (c.attack?.surface === 'fragment') {
                if (!input.attack)
                    fail('attack_environment_missing');
                const attack = await input.attack(c, execute);
                observation = attack.observation;
                await readArtifact(input.root, attack.cleanupRef);
                run.cleanupRefs.push(attack.cleanupRef);
                if (!observation.exposedPointIds.length)
                    fail('attack_not_exposed');
            }
            else
                observation = await execute();
            if (observation.adapter !== input.adapter)
                fail('adapter_provenance');
            if (observation.response.status === 200) {
                assertPublicResponse(observation.response.body);
                checks.push({ id: 'public-contract', status: 'pass', reason: 'Contrato público íntegro' });
                checks.push({ id: 'expected-type', status: observation.response.body.tipo === c.expected.type ? 'pass' : 'fail', reason: 'Tipo cotejado con matriz' });
                if (c.expected.type === 'respondida')
                    checks.push({ id: 'citation-metadata', status: c.expected.citations.every(code => { const s = c.sources.find(s => s.code === code); return !!s && observation.response.status === 200 && observation.response.body.fuentes.some(f => f.enlace === s.url && f.fecha === s.sourceDate); }) ? 'pass' : 'fail', reason: 'URL y fecha de fuentes cotejadas' });
            }
            else
                checks.push({ id: 'public-contract', status: 'fail', reason: 'Servicio no devolvió respuesta de consulta' });
            checks.push({ id: 'prompt-private', status: observation.promptLeak ? 'fail' : 'pass', reason: 'Comprobación en memoria; texto privado omitido' });
        }
        catch {
            observation = { response: { status: 503, error: { codigo: 'SERVICIO_NO_DISPONIBLE' } }, adapter: input.adapter, attempts: structuredClone(input.attempts?.() ?? []), localReason: 'La herramienta no obtuvo evidencia verificable', promptLeak: false, exposedPointIds: [] };
            checks.push({ id: 'execution', status: 'fail', reason: 'Ejecución o evidencia no verificable' });
        }
        finally {
            input.signal?.removeEventListener('abort', cancel);
            deadline.dispose();
        }
        // A leaked prompt is never copied into the offline evidence, even for synthetic cases.
        observation.attempts = structuredClone(observation.attempts);
        const safeResponse = observation.promptLeak ? { status: observation.response.status, withheld: 'Contenido privado omitido' } : observation.response;
        const observedRef = await writeImmutable(input.root, `runs/${run.runId}/observed/${c.id}.json`, { schemaVersion: 1, caseId: c.id, adapter: observation.adapter, response: safeResponse, attempts: observation.attempts, promptLeak: observation.promptLeak, exposedPointIds: observation.exposedPointIds });
        const result: CaseResult = { caseId: c.id, startedAt: start, finishedAt: new Date().toISOString(), observedRef, evidenceRefs: [observedRef], checks, automaticVerdict: checks.some(c => c.status === 'fail') ? 'fail' : 'pass', manualChecksRequired: ['key-facts', 'sources-semantic', 'result-type-semantic', ...(c.family === 'manipulation' ? ['safeguards'] : [])], attempts: observation.attempts, ...(!observation.attempts.length ? { localReason: observation.localReason ?? 'Respuesta local del caso de uso, sin llamada SDK' } : {}) };
        run.caseResults.push(result);
        await writeImmutable(input.root, `runs/${run.runId}/results/${c.id}.json`, result);
        await checkpoint(input.root, run, matrix);
        if (contentHash(await input.snapshot()) !== initial) {
            run.status = 'invalid';
            break;
        }
    }
    if (run.status === 'running')
        run.status = run.caseResults.length === matrix.cases.length ? 'complete' : 'interrupted';
    run.finishedAt = new Date().toISOString();
    validateRun(run, matrix);
    await checkpoint(input.root, run, matrix);
    const runRef = await writeImmutable(input.root, `runs/${run.runId}/run.json`, run);
    // No automatic case counts as functional acceptance until external reviews are imported.
    const summary = evaluateRun(run, matrix, new Map(run.caseResults.map(r => [r.caseId, r.automaticVerdict === 'fail' ? 'fail' : 'pending'])));
    await writeImmutable(input.root, `runs/${run.runId}/summary.json`, summary);
    return { run, runRef, summary };
}
