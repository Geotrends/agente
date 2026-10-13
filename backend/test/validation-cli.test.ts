import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../scripts/validation.js';
import { artifactFixture } from './validation-support.js';
import { jsonArtifact, artifact } from '../scripts/lib/validation/artifacts.js';
import { verifyRelease } from '../scripts/lib/validation/identity.js';
test('check/freezing usan refs seguras y output nuevo; versión/env distinta falla', async () => {
    const root = await mkdtemp(join(tmpdir(), 'validation-cli-'));
    const fixture = await artifactFixture(root);
    const args = [`--root=${root}`, '--matrix=matrix.json', '--base=base.json', '--kind=c3', '--output=diagnostic.json'];
    assert.equal(await main(['check', ...args]), 0);
    await assert.rejects(main(['check', ...args]));
    await assert.rejects(main(['check', ...args, '--only=one']));
    await assert.rejects(main(['check', ...args.map(a => a === '--matrix=matrix.json' ? '--matrix=../matrix.json' : a)]));
    const diagnostic = await jsonArtifact(root, await artifact(root, 'diagnostic.json', 'application/json')) as {
        approvalVerified: boolean;
    };
    assert.equal(diagnostic.approvalVerified, false);
    const release = await jsonArtifact(root, fixture.releaseRef);
    assert.equal((await verifyRelease(root, release)).releaseId, 'fixture-release');
    await assert.rejects(verifyRelease(root, { ...(release as object), policyVersion: 'changed-policy' }));
});
test('CLI VA rechaza filtros, variantes desconocidas y argumentos duplicados antes de llamar proveedores', async () => {
    const { validationCommand } = await import('../scripts/lib/validation/vaCommand.js');
    for (const args of [['--suite=va', '--only=one'], ['--suite=va', '--adapter=other'], ['--suite=va', '--suite=va']])
        await assert.rejects(validationCommand(args));
});

import { produceValidationEvidence } from '../scripts/lib/diRunner.js';
import { writeImmutable, readLedger } from '../scripts/lib/validation/artifacts.js';
import { findingFixture, personFixture } from './validation-support.js';
test('CLI de hallazgos exige origen/caso/modelo verificables y conserva ledger y vista en transición', async () => {
    const root = await mkdtemp(join(tmpdir(), 'validation-finding-cli-'));
    const f = await artifactFixture(root);
    let n = 0;
    const execute = async () => ({ response: { status: 503 as const, error: { codigo: 'SERVICIO_NO_DISPONIBLE' as const } }, adapter: 'double' as const, attempts: [], localReason: 'Fallo local sintético sin inferencia', promptLeak: false, exposedPointIds: ['synthetic-point'] });
    const output = await produceValidationEvidence({ root, matrixRef: f.matrixRef, freezeRef: f.freezeRef, releaseRef: f.releaseRef, mode: 'integrated', adapter: 'double', execute, snapshot: async () => ({ fixture: 'controlled' }), attack: async (_row, run) => ({ observation: await run(), cleanupRef: await writeImmutable(root, `cleanup-fixture-${n++}.json`, { fixture: 'Synthetic cleanup port only' }) }) });
    const now = new Date().toISOString();
    const finding = { ...findingFixture(), originRunId: output.run.runId, caseId: f.matrix.cases[0].id, matrixRef: f.matrixRef, evaluatedModel: null, priority: 'Media', description: 'Respuesta local no disponible: clasificación sintética', events: [{ id: 'registered', at: now, by: personFixture, from: null, to: 'Registrada', description: 'Registro sintético sin aceptación', evidenceRef: f.matrixRef }] };
    await writeImmutable(root, 'finding-input.json', finding);
    const args = ['finding-register', `--root=${root}`, '--finding=finding-input.json', `--run=${output.runRef.path}`, '--output=registered.json'];
    assert.equal(await main(args), 0);
    assert.equal((await readLedger(root, 'finding-ledger')).length, 1);
    await writeImmutable(root, 'wrong-origin.json', { ...finding, caseId: 'unknown-case' });
    await assert.rejects(main(args.map(v => v === '--finding=finding-input.json' ? '--finding=wrong-origin.json' : v === '--output=registered.json' ? '--output=bad.json' : v)));
    await writeImmutable(root, 'analysis-event.json', { id: 'analysis', at: new Date().toISOString(), by: personFixture, from: 'Registrada', to: 'En análisis', description: 'Analizar causa antes de ajustar', evidenceRef: f.matrixRef });
    assert.equal(await main(['finding-transition', `--root=${root}`, '--finding=registered.json', '--event=analysis-event.json', '--output=analysis.json']), 0);
    assert.equal((await readLedger(root, 'finding-ledger')).length, 2);
    assert.equal((await jsonArtifact(root, await artifact(root, 'registered.json', 'application/json')) as { status: string }).status, 'Registrada');
    const view = await artifact(root, 'analysis.json.md', 'text/markdown');
    assert.equal(view.mediaType, 'text/markdown');
});
