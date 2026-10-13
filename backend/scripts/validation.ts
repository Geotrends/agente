import { importPrResults } from './lib/validation/prImport.js';
import { executionEnvironment, assertRealEnvironment } from './lib/validation/environments.js';
import { generateReport,renderReport } from './lib/validation/report.js';
import { assessPackage } from './lib/validation/packages.js';
import { verifyActa } from './lib/validation/actas.js';
import { dirname, join } from 'node:path';
import { readLedger } from './lib/validation/artifacts.js';
import { checkC4, freezeC4 } from './lib/validation/freezeC4.js';
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readJson } from "./lib/validation/readJson.js";
import { validateFinding } from "./lib/validation/findings.js";
import { transitionFinding, type FindingProof } from "./lib/validation/findingValidation.js";
import { findingsMarkdown } from "./lib/validation/findingViews.js";
import { loadEvaluation } from "./lib/validation/loadEvaluation.js";
import { object, list, ref, version, id } from "./lib/validation/types.js";
import { contentHash } from "./lib/validation/hash.js";
import { validateReview, deriveResult } from "./lib/validation/review.js";
import { verifyRelease } from "./lib/validation/identity.js";
import { artifact, appendEvent, jsonArtifact, readArtifact, writeTextImmutable } from "./lib/validation/artifacts.js";
import { freezeMatrix, checkC3 } from "./lib/validation/freeze.js";
import { person, enumeration } from "./lib/validation/types.js";
import { treeManifest } from "./lib/validation/identity.js";
import { adjustmentEvent,recordAdjustment } from "./lib/validation/events.js";
import { writeImmutable } from "./lib/validation/artifacts.js";
import { ValidationError, fail } from "./lib/validation/types.js";
export function argumentsFor(args: string[], allowed: readonly string[]): Map<string, string> {
    const options = new Map<string, string>();
    for (const arg of args) {
        const m = arg.match(/^--([a-z][a-z-]*)=(.+)$/);
        if (!m || !allowed.includes(m[1]) || options.has(m[1]))
            fail('arguments', '', 2);
        options.set(m[1], m[2]);
    }
    return options;
}
export async function main(args = process.argv.slice(2)): Promise<number> {
    const [command, ...rest] = args;
    if (command === 'pr-import') {
        const a = argumentsFor(rest, ['root', 'run', 'results']);
        if (a.size !== 3)
            fail('arguments', '', 2);
        const root = a.get('root')!;
        const r = await importPrResults(root, await artifact(root, a.get('run')!, 'application/json'), await jsonArtifact(root, await artifact(root, a.get('results')!, 'application/json')));
        return r.run.status === 'complete' ? 0 : 1;
    }
    if (command === 'report') {
        const a = argumentsFor(rest.map(v => v === '--require-ready' ? '--require-ready=true' : v), ['root', 'milestone', 'package', 'output', 'require-ready']);
        for (const k of ['root', 'milestone', 'package', 'output'])
            if (!a.has(k))
                fail('arguments', '', 2);
        if (a.has('require-ready') && a.get('require-ready') !== 'true')
            fail('arguments', '', 2);
        const root = a.get('root')!;
        const input = await jsonArtifact(root, await artifact(root, a.get('package')!, 'application/json')) as Record<string, unknown>;
        if (input.milestone !== a.get('milestone'))
            fail('milestone');
        const result = await generateReport(root, input, a.get('output')!);
        console.log(JSON.stringify({ packageRef: result.packageRef, status: result.pkg.status }));
        return a.has('require-ready') && !result.assessment.ready ? 1 : 0;
    }
    if (command === 'acta') {
        const a = argumentsFor(rest, ['root', 'package', 'receipt', 'output']);
        if (a.size !== 4)
            fail('arguments', '', 2);
        const root = a.get('root')!;
        const packageRef = await artifact(root, a.get('package')!, 'application/json');
        const pkg = object(await jsonArtifact(root, packageRef), ['schemaVersion', 'id', 'milestone', 'releaseRef', 'matrixRef', 'latestRunRefs', 'findingsRef', 'adjustmentsRef', 'sharedVerificationRefs', 'reportRef', 'gateVerdicts', 'status', 'actaReceipt'], ['schemaVersion', 'id', 'milestone', 'releaseRef', 'matrixRef', 'latestRunRefs', 'findingsRef', 'adjustmentsRef', 'sharedVerificationRefs', 'reportRef', 'gateVerdicts', 'status']);
        version(pkg.schemaVersion); id(pkg.id);
        if (pkg.status !== 'ready-for-signature')
            fail('acta_package_pending');
        const inputRef = await artifact(root, join(dirname(a.get('package')!), 'insumos.json'), 'application/json');
        const assessed = await assessPackage(root, await jsonArtifact(root, inputRef));
        if (!assessed.ready || !assessed.lastFinishedAt)
            fail('acta_gates_pending');
        for (const key of ['releaseRef', 'matrixRef', 'findingsRef', 'adjustmentsRef', 'sharedVerificationRefs'])
            if (contentHash(pkg[key]) !== contentHash(assessed.input[key as keyof typeof assessed.input]))
                fail('acta_package_sources');
        if (contentHash(pkg.latestRunRefs) !== contentHash(assessed.latestRunRefs) || contentHash(pkg.gateVerdicts) !== contentHash(assessed.gates))
            fail('acta_package_changed');
        const reportRef = ref(pkg.reportRef);
        const reportBytes=await readArtifact(root,reportRef);if(reportBytes.toString('utf8')!==renderReport(assessed))fail('acta_report_contents');
        const receiptRef = await artifact(root, a.get('receipt')!, 'application/json');
        await verifyActa(root, await jsonArtifact(root, receiptRef), { milestone: assessed.input.milestone, ready: assessed.ready, reportHash: reportRef.sha256, matrixVersion: assessed.matrixVersion, models: assessed.release.enabledModels, chatbotVersion: assessed.release.bundleHash, lastFinishedAt: assessed.lastFinishedAt });
        await writeImmutable(root, a.get('output')!, { ...pkg, status: 'signed', actaReceipt: receiptRef });
        await appendEvent(root, 'events', { id: String(pkg.id) + '-signed-' + Date.now(), kind: 'acta-verified', at: new Date().toISOString(), packageRef, receiptRef });
        return 0;
    }
    if (command === 'finding-register' || command === 'finding-transition') {
        const a = argumentsFor(rest, command === 'finding-register' ? ['root', 'finding', 'run', 'output'] : ['root', 'finding', 'event', 'proof', 'output']);
        for (const k of command === 'finding-register' ? ['root', 'finding', 'run', 'output'] : ['root', 'finding', 'event', 'output'])
            if (!a.has(k))
                fail('arguments', '', 2);
        const root = a.get('root')!;
        const findingRef = await artifact(root, a.get('finding')!, 'application/json');
        let finding = validateFinding(await jsonArtifact(root, findingRef));
        for (const r of [finding.matrixRef, ...finding.previousFindingRefs, ...finding.events.flatMap(e => [e.evidenceRef, ...(e.priorityReview ? [e.priorityReview.evidenceRef] : [])])])
            await readArtifact(root, r);
        if (command === 'finding-register') {
            if (!a.has('run')) fail('origin_run_required', '', 2);
            const origin = await loadEvaluation(root, await artifact(root, a.get('run')!, 'application/json'), []);
            const result = origin.run.caseResults.find(r => r.caseId === finding.caseId);
            const observedModel = origin.run.targetModel ?? result?.attempts.find(a => a.status === 'success')?.effectiveModel ?? null;
            if (!result || finding.originRunId !== origin.run.runId || contentHash(finding.matrixRef) !== contentHash(origin.run.matrixRef) ||
                (origin.run.suite === 'c3' ? finding.evaluatedModel !== observedModel : finding.environment !== result.environment) ||
                finding.status !== 'Registrada' || finding.events.length !== 1 || Date.parse(finding.events[0].at) < Date.parse(result.finishedAt)) fail('finding_origin');
        }
        if (command === 'finding-transition') {
            const eventRef = await artifact(root, a.get('event')!, 'application/json');
            const event = await jsonArtifact(root, eventRef) as {
                to: import('./lib/validation/findings.js').FindingState;
            };
            let proof: FindingProof | undefined;
            if (a.has('proof')) {
                const input = object(await jsonArtifact(root, await artifact(root, a.get('proof')!, 'application/json')), ['runs', 'adjustmentReleaseRef']);
                const loaded = await Promise.all(list(input.runs, 1).map(async (v) => { const r = object(v, ['runRef', 'reviewRefs']); return loadEvaluation(root, ref(r.runRef), list(r.reviewRefs).map(ref)); }));
                const first = loaded[0];
                if (loaded.some(x => contentHash(x.matrix) !== contentHash(first.matrix)))
                    fail('finding_proof_matrix');
                proof = { matrix: first.matrix, runs: loaded.map(x => ({ run: x.run, ref: x.runRef, verdicts: x.verdicts })), enabledModels: first.release.enabledModels, adjustmentReleaseRef: ref(input.adjustmentReleaseRef) };
                const adjustedRelease=await verifyRelease(root,await jsonArtifact(root,proof.adjustmentReleaseRef));const lastAdjustment=finding.events.filter(e=>e.to==='Ajustada').at(-1);if(!lastAdjustment?.adjustmentRef)fail('finding_adjustment');const recorded=adjustmentEvent(await jsonArtifact(root,lastAdjustment.adjustmentRef));if(recorded.nextReleaseId!==adjustedRelease.releaseId||Date.parse(String(recorded.at))>Date.parse(lastAdjustment.at))fail('finding_adjustment_release');
                for (const item of proof.runs) {
                    const related = (await readLedger(root, 'events')).filter(e => typeof e.runId === 'string' && e.runId !== item.run.runId && typeof e.at === 'string' && Date.parse(e.at) >= Date.parse(item.run.startedAt) && e.runRef);
                    for (const e of related) {
                        const candidate = await jsonArtifact(root, e.runRef) as Record<string, unknown>;
                        if (contentHash(candidate.matrixRef) === contentHash(item.run.matrixRef) && candidate.mode === item.run.mode && candidate.targetModel === item.run.targetModel)
                            fail('finding_newer_run_exists');
                    }
                }
            }
            finding = transitionFinding(finding, event.to, event, proof);
        }
        const outputRef = await writeImmutable(root, a.get('output')!, finding);
        await writeTextImmutable(root, a.get('output')! + '.md', findingsMarkdown([finding]));
        await appendEvent(root, 'finding-ledger', { id: finding.id + '-' + finding.events.at(-1)!.id, at: finding.events.at(-1)!.at, findingRef: outputRef });
        return 0;
    }
    if (command === 'review') {
        const a = argumentsFor(rest, ['root', 'run', 'review', 'output']);
        if (a.size !== 4)
            fail('arguments', '', 2);
        const root = a.get('root')!;
        const runRef = await artifact(root, a.get('run')!, 'application/json');
        const loaded = await loadEvaluation(root, runRef, []);
        const { matrix, run, release } = loaded;
        const reviewRef = await artifact(root, a.get('review')!, 'application/json');
        const input = await jsonArtifact(root, reviewRef) as Record<string, unknown>;
        const result = run.caseResults.find(c => c.caseId === input.caseId || input.scope === 'case:' + c.caseId);
        if (!result)
            fail('review_case');
        const review = validateReview(input, { runId: run.runId, result, matrixHash: contentHash(matrix), releaseId: release.releaseId });
        await readArtifact(root, review.evidenceRef);
        if (result.executionEnvironmentRef && review.checksReviewed.some(c => /reader|device/.test(c))) {
            const env = executionEnvironment(await jsonArtifact(root, result.executionEnvironmentRef));
            await readArtifact(root, env.evidenceRef);
            assertRealEnvironment(env, result.environment!, review.checksReviewed.includes('reader'));
        }
        const previousRefs = (await readLedger(root, 'events')).filter(e => e.kind === 'review' && contentHash(e.runRef) === contentHash(runRef)).map(e => ref(e.receiptRef));
        const previous = [];
        const selectedRefs = [];
        for (const r of previousRefs) {
            const raw = await jsonArtifact(root, r) as Record<string, unknown>;
            if (raw.caseId === result.caseId || raw.scope === 'case:' + result.caseId) {
                const checked = validateReview(raw, { runId: run.runId, result, matrixHash: contentHash(matrix), releaseId: release.releaseId });
                await readArtifact(root, checked.evidenceRef);
                previous.push(checked);
                selectedRefs.push(r);
            }
        }
        const receiptRef = await writeImmutable(root, a.get('output')!, review);
        const rawResultRef = await writeImmutable(root, a.get('output')! + '.raw-result.json', result);
        await writeImmutable(root, a.get('output')! + '.evaluated.json', { runId: run.runId, caseId: result.caseId, rawResultRef, reviewRefs: [...selectedRefs, receiptRef], finalVerdict: deriveResult(result, [...previous, review]), derivedAt: new Date().toISOString(), reasons: [] });
        await appendEvent(root, 'events', { id: review.id, kind: 'review', at: review.at, runRef, receiptRef });
        return 0;
    }
    if (command === 'check' || command === 'freeze') {
        const a = argumentsFor(rest, command === 'check' ? ['root', 'matrix', 'base', 'kind', 'output', 'c3-freeze'] : ['root', 'matrix', 'base', 'approval', 'by', 'output', 'c3-freeze']);
        const required = command === 'check' ? ['root', 'matrix', 'base', 'kind', 'output'] : ['root', 'matrix', 'base', 'approval', 'by', 'output'];
        if (required.some(k => !a.has(k)))
            fail('arguments', '', 2);
        const root = a.get('root')!;
        const matrixRef = await artifact(root, a.get('matrix')!, 'application/json');
        const baseRef = await artifact(root, a.get('base')!, 'application/json');
        if (command === 'check') {
            const kind = enumeration(a.get('kind'), ['c3', 'c4']);
            if (kind === 'c4' && !a.has('c3-freeze'))
                fail('c3_freeze_required', '', 2);
            const result = kind === 'c3' ? await checkC3(root, await jsonArtifact(root, matrixRef), baseRef) : await checkC4(root, await jsonArtifact(root, matrixRef), await artifact(root, a.get('c3-freeze')!, 'application/json'), false, baseRef);
            await writeImmutable(root, a.get('output')!, { schemaVersion: 1, matrixRef, coverage: result.coverage, approvalVerified: false });
            return 0;
        }
        const approvalRef = await artifact(root, a.get('approval')!, 'application/json');
        const by = person(await readJson(a.get('by')!));
        const matrixValue = await jsonArtifact(root, matrixRef) as {
            kind: string;
        };
        if (matrixValue.kind === 'c4' && !a.has('c3-freeze'))
            fail('c3_freeze_required', '', 2);
        const receipt = matrixValue.kind === 'c4' ? await freezeC4(root, matrixRef, approvalRef, await artifact(root, a.get('c3-freeze')!, 'application/json'), by) : await freezeMatrix(root, matrixRef, approvalRef, baseRef, by);
        const receiptRef = await writeImmutable(root, a.get('output')!, receipt);
        await appendEvent(root, 'events', { schemaVersion: 1, id: receipt.id, at: receipt.frozenAt, kind: 'freeze', matrixRef, receiptRef });
        return 0;
    }
    if (command === 'identity-tree') {
        const a = argumentsFor(rest, ['source-root', 'root', 'output']);
        if (a.size !== 3)
            fail('arguments', '', 2);
        await writeImmutable(a.get('root')!, a.get('output')!, await treeManifest(a.get('source-root')!));
        return 0;
    }
    if (command === 'adjustment') {
        const a = argumentsFor(rest, ['root', 'event']);
        if (a.size !== 2)
            fail('arguments', '', 2);
        await recordAdjustment(a.get('root')!, await readJson(a.get('event')!));
        return 0;
    }
    fail('unknown_command', '', 2);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().then(code => { process.exitCode = code; }).catch(error => { console.error(error instanceof ValidationError ? error.message : 'configuration_or_io_error'); process.exitCode = error instanceof ValidationError ? error.exitCode : 2; });
