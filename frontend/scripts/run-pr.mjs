import { register } from 'tsx/esm/api';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
register();
const V = await import('../../backend/scripts/validation.ts');
const A = await import('../../backend/scripts/lib/validation/artifacts.ts');
const T = await import('../../backend/scripts/lib/validation/types.ts');
const H = await import('../../backend/scripts/lib/validation/hash.ts');
const F = await import('../../backend/scripts/lib/validation/freezeC4.ts');
const I = await import('../../backend/scripts/lib/validation/identity.ts');
const E = await import('../../backend/scripts/lib/validation/environments.ts');
const R = await import('../../backend/scripts/lib/validation/runs.ts');
const C = await import('../../backend/scripts/lib/validation/matrixC3.ts');
const Eval = await import('../../backend/scripts/lib/validation/evaluation.ts');
try {
    const a = V.argumentsFor(process.argv.slice(2), ['root', 'matrix', 'freeze', 'release', 'environments', 'target', 'mobile', 'source-root']);
    if (!['root', 'matrix', 'freeze', 'release', 'environments', 'target', 'source-root'].every(k => a.has(k)))
        T.fail('arguments', '', 2);
    const mobile = T.enumeration(a.get('mobile') ?? 'emulated', ['emulated', 'manual']);
    const root = resolve(a.get('root'));
    const matrixRef = await A.artifact(root, a.get('matrix'), 'application/json'), freezeRef = await A.artifact(root, a.get('freeze'), 'application/json'), releaseRef = await A.artifact(root, a.get('release'), 'application/json');
    const freeze = await A.jsonArtifact(root, freezeRef);
    const { matrix } = await F.checkC4(root, await A.jsonArtifact(root, matrixRef), freeze.c3FreezeRef, true);
    const release = await I.verifyRelease(root, await A.jsonArtifact(root, releaseRef));
    const sourceRoot = resolve(a.get('source-root'));
    if ((await I.treeManifest(sourceRoot)).treeHash !== release.treeHash) T.fail('runtime_tree_identity', '', 2);
    if (!release.matrixRefs.some(r => H.contentHash(r) === H.contentHash(matrixRef)))
        T.fail('release_matrix');
    const startedAt = new Date().toISOString();
    await F.verifyFreezeC4(root, matrixRef, freeze, new Date(startedAt));
    const target = T.object(await A.jsonArtifact(root, await A.artifact(root, a.get('target'), 'application/json')), ['hostUrl', 'chatUrl']);
    for (const url of Object.values(target)) {
        const u = new URL(T.text(url));
        if (u.protocol !== 'https:' || u.username || u.password)
            T.fail('https_target', '', 2);
    }
    const input = T.object(await A.jsonArtifact(root, await A.artifact(root, a.get('environments'), 'application/json')), ['desktop', 'mobile']);
    const runId = 'pr-' + randomUUID(), environments = {};
    for (const env of ['desktop', 'mobile']) {
        const sourceRef = T.ref(input[env]);
        const e = E.executionEnvironment(await A.jsonArtifact(root, sourceRef));
        await A.readArtifact(root, e.evidenceRef);
        if (e.hostUrl !== target.hostUrl || e.chatUrl !== target.chatUrl || e.connection !== 'real' || env === 'mobile' && e.deviceKind !== (mobile === 'manual' ? 'physical' : 'emulated'))
            T.fail('automated_environment_requires_real_connection_and_emulated_device', '', 2);
        environments[env] = { ref: sourceRef, viewport: e.viewport, browserVersion: e.browserVersion, deviceKind: e.deviceKind };
    }
    const releaseEnvironment = await A.jsonArtifact(root, release.environmentRef);
    const adapter = releaseEnvironment.executionClass === 'real' && mobile === 'manual' && environments.desktop.deviceKind === 'physical' ? 'aws' : 'controlled';
    const c3 = C.matrixC3(await A.jsonArtifact(root, matrix.c3MatrixRef), false);
    const initial = H.contentHash({ matrix: await A.jsonArtifact(root, matrixRef), freeze, release });
    const run = { schemaVersion: 1, runId, matrixRef, freezeRef, releaseRef, suite: 'c4', mode: 'functional', adapter, startedAt, finishedAt: null, status: 'running', caseResults: [], cleanupRefs: [], artifacts: [] };
    await A.writeImmutable(root, `runs/${runId}/checkpoints/0-running.json`, run);
    await A.appendEvent(root, 'events', { id: runId + '-start', at: startedAt, kind: 'run-progress', runId, runRef: await A.artifact(root, `runs/${runId}/checkpoints/0-running.json`, 'application/json') });
    const job = await A.writeImmutable(root, `runs/${runId}/job.json`, { root, runId, matrix, c3, target, environments, adapter, executionCaseIds: matrix.cases.filter(c => mobile !== 'manual' || c.environment === 'desktop').map(c => c.id) });
    const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const child = spawn(process.execPath, [resolve(frontendRoot, 'node_modules/@playwright/test/cli.js'), 'test', '-c', 'playwright.acceptance.config.ts'], { cwd: frontendRoot, stdio: 'inherit', env: { ...process.env, PR_JOB: await A.safePath(root, job.path) } });
    let interrupted = false;
    const stop = () => { interrupted = true; child.kill('SIGTERM'); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    const code = await new Promise(res => { child.once('exit', res); child.once('error', () => { interrupted = true; res(2); }); });
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    for (const row of matrix.cases) {
        try {
            const ref = await A.artifact(root, `runs/${runId}/results/${row.id}.json`, 'application/json');
            run.caseResults.push(await A.jsonArtifact(root, ref));
            await A.writeImmutable(root, `runs/${runId}/checkpoints/${run.caseResults.length}-running.json`, run);
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
    }
    run.status = interrupted ? 'interrupted' : run.caseResults.length === matrix.cases.length ? 'complete' : mobile === 'manual' && code === 0 ? 'running' : 'interrupted';
    if ((await I.treeManifest(sourceRoot)).treeHash !== release.treeHash) run.status = 'invalid';
    if (initial !== H.contentHash({ matrix: await A.jsonArtifact(root, matrixRef), freeze: await A.jsonArtifact(root, freezeRef), release: await A.jsonArtifact(root, releaseRef) }))
        run.status = 'invalid';
    run.finishedAt = run.status === 'running' ? null : new Date().toISOString();
    R.validateRun(run, matrix);
    const runRef = await A.writeImmutable(root, `runs/${runId}/${run.status === 'running' ? 'awaiting-manual.json' : 'run.json'}`, run);
    await A.appendEvent(root, 'events', { id: runId + '-end', at: new Date().toISOString(), kind: run.status === 'complete' ? 'run-complete' : run.status === 'running' ? 'run-progress' : 'run-interrupted', runId, runRef });
    const summary = Eval.evaluateRun(run, matrix, new Map(run.caseResults.map(r => [r.caseId, r.automaticVerdict === 'fail' ? 'fail' : 'pending'])));
    await A.writeImmutable(root, `runs/${runId}/summary.json`, summary);
    console.log(JSON.stringify({ runId, results: run.caseResults.length, adapter, exit: code, summary }));
    process.exitCode = 1;
}
catch (error) {
    console.error(error instanceof T.ValidationError ? error.message : 'configuration_or_io_error');
    process.exitCode = error instanceof T.ValidationError ? error.exitCode : 2;
}
