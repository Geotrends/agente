import {transitionFinding} from './findingValidation.js';
import { sourceRequirements } from './sourceRequirements.js';
import { object, version, id, ref, list, enumeration, text, instant, person, fail, type ArtifactRef } from './types.js';
import { readArtifact, jsonArtifact, readLedger } from './artifacts.js';
import { contentHash } from './hash.js';
import { verifyRelease } from './identity.js';
import { loadEvaluation } from './loadEvaluation.js';
import { evaluateRun, latestRun } from './evaluation.js';
import { validateFinding } from './findings.js';
import { assertFindingCoverage } from './findingValidation.js';
import { adjustmentEvent } from './events.js';
import { verifyShared } from './sharedEvidence.js';
import { executionEnvironment, assertRealEnvironment } from './environments.js';
export type Gate = {
    requirementId: string;
    verdict: 'pass' | 'fail' | 'pending';
    reason: string;
    evidenceRefs: ArtifactRef[];
};
export type MilestonePackage = {
    schemaVersion: 1;
    id: string;
    milestone: 'H5-C3' | 'H4-C4';
    releaseRef: ArtifactRef;
    matrixRef: ArtifactRef;
    latestRunRefs: ArtifactRef[];
    findingsRef: ArtifactRef;
    adjustmentsRef: ArtifactRef;
    sharedVerificationRefs: ArtifactRef[];
    reportRef: ArtifactRef;
    gateVerdicts: Gate[];
    status: 'draft' | 'ready-for-signature' | 'signed' | 'invalidated';
    actaReceipt?: ArtifactRef;
};
export type PackageInput = {
    schemaVersion: 1;
    id: string;
    milestone: 'H5-C3' | 'H4-C4';
    releaseRef: ArtifactRef;
    matrixRef: ArtifactRef;
    runs: {
        runRef: ArtifactRef;
        reviewRefs: ArtifactRef[];
    }[];
    findingsRef: ArtifactRef;
    adjustmentsRef: ArtifactRef;
    sharedVerificationRefs: ArtifactRef[];
    sourceGatesRef: ArtifactRef;
};
export function packageInput(value: unknown): PackageInput { const o = object(value, ['schemaVersion', 'id', 'milestone', 'releaseRef', 'matrixRef', 'runs', 'findingsRef', 'adjustmentsRef', 'sharedVerificationRefs', 'sourceGatesRef']); version(o.schemaVersion); id(o.id); enumeration(o.milestone, ['H5-C3', 'H4-C4']); for (const key of ['releaseRef', 'matrixRef', 'findingsRef', 'adjustmentsRef', 'sourceGatesRef'])
    ref(o[key]); list(o.sharedVerificationRefs).forEach(ref); list(o.runs).forEach(v => { const r = object(v, ['runRef', 'reviewRefs']); ref(r.runRef); list(r.reviewRefs).forEach(ref); }); return o as unknown as PackageInput; }
export async function assessPackage(root: string, value: unknown): Promise<{
    input: PackageInput;
    gates: Gate[];
    latestRunRefs: ArtifactRef[];
    runSummaries:{runId:string;mode:string;targetModel?:string;adapter:string;status:string;ref:ArtifactRef;summary:ReturnType<typeof evaluateRun>;cleanupRefs:ArtifactRef[]}[];
    lastFinishedAt: string | null;
    release: Awaited<ReturnType<typeof verifyRelease>>;
    matrixVersion: string;
    ready: boolean;
}> {
    const input = packageInput(value), release = await verifyRelease(root, await jsonArtifact(root, input.releaseRef));
    await readArtifact(root, input.matrixRef);
    if (!release.matrixRefs.some(r => contentHash(r) === contentHash(input.matrixRef)))
        fail('package_matrix_release');
    const matrixValue = await jsonArtifact(root, input.matrixRef) as {
        kind: string;
        version: string;
    };
    if (matrixValue.kind !== (input.milestone === 'H5-C3' ? 'c3' : 'c4'))
        fail('package_suite');
    const findings = list(await jsonArtifact(root, input.findingsRef)).map(validateFinding), adjustments = list(await jsonArtifact(root, input.adjustmentsRef)).map(adjustmentEvent);
    const loaded = await Promise.all(input.runs.map(r => loadEvaluation(root, r.runRef, r.reviewRefs)));
    const gates: Gate[] = [];
    const add = (requirementId: string, pass: boolean, reason: string, evidenceRefs: ArtifactRef[] = []) => gates.push({ requirementId, verdict: pass ? 'pass' : 'pending', reason, evidenceRefs });
    const environment = await jsonArtifact(root, release.environmentRef) as {
        executionClass: string;
    };
    add('release-real', environment.executionClass === 'real', 'Entorno de release verificado como real', [release.environmentRef]);
    const latestRunRefs: ArtifactRef[] = [];
    const runSummaries:{runId:string;mode:string;targetModel?:string;adapter:string;status:string;ref:ArtifactRef;summary:ReturnType<typeof evaluateRun>;cleanupRefs:ArtifactRef[]}[]=[];
    let lastFinishedAt: string | null = null;
    const expected = input.milestone === 'H5-C3' ? [{ mode: 'integrated', model: undefined }, { mode: 'independent', model: release.enabledModels[0] }, { mode: 'independent', model: release.enabledModels[1] }] : [{ mode: 'functional', model: undefined }];
    for (const group of expected) {
        const relevant = loaded.filter(x => x.run.mode === group.mode && x.run.targetModel === group.model);
        const history = new Map(relevant.map(x => [x.run.runId, x.run]));
        for (const e of await readLedger(root, 'events'))
            if (e.runRef) {
                const candidate = await jsonArtifact(root, e.runRef) as import('./runs.js').Run;
                if (candidate.mode === group.mode && candidate.targetModel === group.model && contentHash(candidate.matrixRef) === contentHash(input.matrixRef) && !history.has(candidate.runId))
                    history.set(candidate.runId, candidate);
            }
        const latest = latestRun([...history.values()], adjustments as unknown as Record<string, unknown>[]);
        const chosen = relevant.find(x => x.run.runId === latest?.runId);
        const matching = chosen && contentHash(chosen.run.releaseRef) === contentHash(input.releaseRef) && contentHash(chosen.run.matrixRef) === contentHash(input.matrixRef);
        let pass = false;
        if (matching && chosen) {
            const summary = evaluateRun(chosen.run, chosen.matrix, chosen.verdicts, environment.executionClass === 'real');
            runSummaries.push({runId:chosen.run.runId,mode:chosen.run.mode,targetModel:chosen.run.targetModel,adapter:chosen.run.adapter,status:chosen.run.status,ref:chosen.runRef,summary,cleanupRefs:chosen.run.cleanupRefs});
            pass = summary.realAcceptance;
            latestRunRefs.push(chosen.runRef);
            if (chosen.run.finishedAt && (!lastFinishedAt || Date.parse(chosen.run.finishedAt) > Date.parse(lastFinishedAt)))
                lastFinishedAt = chosen.run.finishedAt;
            if (chosen.run.suite === 'c4') {
                for (const result of chosen.run.caseResults) {
                    const e = executionEnvironment(await jsonArtifact(root, result.executionEnvironmentRef));
                    try {
                        assertRealEnvironment(e, result.environment!, true);
                    }
                    catch {
                        pass = false;
                    }
                }
            }
        }
        add('run-' + group.mode + (group.model ? '-' + group.model : ''), !!pass, 'Última corrida completa, vigente, revisada y con evidencia real', chosen ? [chosen.runRef] : []);
    }
    try {
        assertFindingCoverage(loaded.map(x => x.run), new Map(loaded.map(x => [x.run.runId, x.verdicts])), findings);
        add('finding-coverage', true, 'Todos los casos no aprobados tienen vínculo', [input.findingsRef]);
    }
    catch {
        add('finding-coverage', false, 'Faltan clasificación/vínculos de resultados no aprobados', [input.findingsRef]);
    }
    let criticalClosed=findings.every(f=>f.priority!=='Crítica'||f.status==='Cerrada');
    for(const finding of findings.filter(f=>f.status==='Cerrada')){try{const proofRuns=[];for(const reference of finding.validationRunRefs){const supplied=input.runs.find(r=>contentHash(r.runRef)===contentHash(reference));const reviews=supplied?.reviewRefs??[];if(!supplied)for(const event of await readLedger(root,'events'))if(event.kind==='review'&&event.receiptRef){const receipt=await jsonArtifact(root,event.receiptRef) as {runId:string};const raw=await jsonArtifact(root,reference) as {runId:string};if(receipt.runId===raw.runId)reviews.push(ref(event.receiptRef));}proofRuns.push(await loadEvaluation(root,reference,reviews));}if(!proofRuns.length)fail('finding_closure_proof');const first=proofRuns[0];const adjustment=finding.events.filter(e=>e.to==='Ajustada').at(-1);if(!adjustment?.adjustmentRef)fail('finding_adjustment');const adjusted=adjustmentEvent(await jsonArtifact(root,adjustment.adjustmentRef));if(adjusted.nextReleaseId!==first.release.releaseId)fail('finding_adjustment_release');const last=finding.events.at(-1)!;transitionFinding({...finding,status:'Validada',events:finding.events.slice(0,-1)},'Cerrada',last,{matrix:first.matrix,runs:proofRuns.map(x=>({run:x.run,ref:x.runRef,verdicts:x.verdicts})),enabledModels:first.release.enabledModels,adjustmentReleaseRef:first.run.releaseRef});}catch{criticalClosed=false;}}
    add('critical-closed',criticalClosed,'Críticos cerrados con prueba posterior comprobada',[input.findingsRef]);
    for (const finding of findings)
        for (const r of [finding.matrixRef, ...finding.previousFindingRefs, ...finding.validationRunRefs, ...finding.events.map(e => e.evidenceRef)])
            await readArtifact(root, r);
    if (input.milestone === 'H4-C4')
        for (const requirement of ['RNF-C4-UI-02', 'RNF-C3-IN-03']) {
            let valid = false;
            const refs: ArtifactRef[] = [];
            for (const reference of input.sharedVerificationRefs) {
                const raw = await jsonArtifact(root, reference) as Record<string, unknown>;
                if (raw.requirementId !== requirement)
                    continue;
                refs.push(reference);
                try {
                    const checked = await verifyShared(root, raw, input.releaseRef);
                    valid = checked.verdict === 'pass';
                }
                catch {
                    valid = false;
                }
            }
            add(requirement, valid && refs.length === 1, 'Evidencia compartida del dueño y misma release', refs);
        }
    const source = object(await jsonArtifact(root, input.sourceGatesRef), ['schemaVersion', 'releaseRef', 'requiredRequirementIds', 'gates', 'by', 'at', 'evidenceRef']);
    version(source.schemaVersion);
    person(source.by);
    instant(source.at);
    await readArtifact(root, ref(source.evidenceRef));
    if (contentHash(ref(source.releaseRef)) !== contentHash(input.releaseRef))
        fail('source_gate_release');
    const declared = list(source.requiredRequirementIds, 1).map(text);
    const required: string[] = [...sourceRequirements];
    if (contentHash([...declared].sort()) !== contentHash([...required].sort()))
        fail('source_catalog_incomplete');
    if (new Set(required).size !== required.length)
        fail('source_gate_duplicate');
    const sourceGates = list(source.gates).map(v => { const g = object(v, ['requirementId', 'verdict', 'reason', 'evidenceRefs']); text(g.requirementId); enumeration(g.verdict, ['pass', 'fail', 'pending']); text(g.reason); list(g.evidenceRefs, 1).forEach(ref); return g as unknown as Gate; });
    for (const g of sourceGates) {
        if (!required.includes(g.requirementId))
            fail('source_gate_unknown');
        for (const r of g.evidenceRefs)
            await readArtifact(root, r);
        if (g.verdict === 'pass') {
            let backed = false;
            for (const r of g.evidenceRefs) {
                if (r.mediaType !== 'application/json')
                    continue;
                const raw = await jsonArtifact(root, r) as Record<string, unknown>;
                if (raw.requirementId !== g.requirementId)
                    continue;
                const result = object(raw, ['schemaVersion', 'requirementId', 'releaseRef', 'ownerSpec', 'ownerCaseId', 'runnerRef', 'status', 'executionClass', 'verdict', 'criteria', 'executedAt', 'evidenceRefs']);
                version(result.schemaVersion);
                id(result.ownerCaseId);
                enumeration(result.ownerSpec, ['001', '002', '003', '004', '005']);
                const owner = { IV: '001', DI: '002', DC: '003', UI: '004', IN: '005' }[g.requirementId.split('-')[2] as 'IV' | 'DI' | 'DC' | 'UI' | 'IN'];
                if (!owner || result.ownerSpec !== owner) fail('source_result_owner');
                instant(result.executedAt);
                await readArtifact(root, ref(result.runnerRef));
                for (const proof of list(result.evidenceRefs, 1).map(ref))
                    await readArtifact(root, proof);
                if (result.status !== 'complete' || result.executionClass !== 'real' || result.verdict !== 'pass' || contentHash(result.releaseRef) !== contentHash(input.releaseRef))
                    continue;
                const criteria = list(result.criteria, 1).map(v => object(v, ['id', 'status', 'observed', 'expected']));
                if (criteria.every(c => { id(c.id); text(c.observed); text(c.expected); return c.status === 'pass'; }))
                    backed = true;
            }
            if (!backed) {
                g.verdict = 'pending';
                g.reason = 'PASS sin resultado fuente completo y real';
            }
        }
    }
    for (const r of required) {
        const found = sourceGates.filter(g => g.requirementId === r);
        if (found.length !== 1)
            add(r, false, 'Criterio fuente ausente o duplicado');
        else
            gates.push(found[0]);
    }
    add('source-reviewed', Date.parse(String(source.at)) <= Date.now() && !!lastFinishedAt && Date.parse(String(source.at)) >= Date.parse(lastFinishedAt), 'Revisión humana de requisitos fuente posterior a corridas', [input.sourceGatesRef]);
    return { input, gates, latestRunRefs, runSummaries, lastFinishedAt, release, matrixVersion: matrixValue.version, ready: gates.every(g => g.verdict === 'pass') };
}
