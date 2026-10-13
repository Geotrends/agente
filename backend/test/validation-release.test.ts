import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseManifest } from '../scripts/lib/validation/identity.js';
import { adjustmentEvent } from '../scripts/lib/validation/events.js';
const h = 'a'.repeat(64), r = { path: 'evidence.json', sha256: h, mediaType: 'application/json' };
const release = { schemaVersion: 1, releaseId: 'release-1', createdAt: '2026-10-11T00:00:00Z', gitCommit: 'a'.repeat(40), treeManifestRef: r, treeHash: h, backendImageDigest: 'sha256:' + h, frontendImageDigest: 'sha256:' + h, bundleHash: h, launcherHash: h, lockfiles: [r], promptHash: h, generationConfigHash: h, enabledModels: ['openai.gpt-oss-20b-1:0', 'openai.gpt-oss-120b-1:0'], baseRef: r, calibrationRef: r, contactsRevision: 'contacts-1', policyVersion: 'policy-1', tariffsHash: h, publicConfigHash: h, environmentRef: r, matrixRefs: [r] };
test('identidad de release exige todos los campos: secretos/outputs no son campos del contrato', () => {
    assert.equal(releaseManifest(release).releaseId, 'release-1');
    for (const key of Object.keys(release)) {
        const v = { ...release } as Record<string, unknown>;
        delete v[key];
        assert.throws(() => releaseManifest(v));
    }
    for (const key of ['treeHash', 'bundleHash', 'promptHash'])
        assert.throws(() => releaseManifest({ ...release, [key]: 'abc' }));
    assert.throws(() => releaseManifest({ ...release, env: 'secret' }));
    assert.throws(() => releaseManifest({ ...release, enabledModels: ['one', 'one'] }));
});
test('ajuste conserva dueño, requisitos, releases e invalidación; no evalúa comandos', () => {
    const event = { schemaVersion: 1, id: 'change-1', at: '2026-10-11T00:00:00Z', scope: 'prompt', previousReleaseId: 'release-1', nextReleaseId: 'release-2', description: 'Cambio documentado', requirementIds: ['RF-C3-VA-02'], owner: { name: 'Revisor sintético de fixture', role: 'fixture' }, invalidatedRunIds: ['run-1'], requiredReruns: ['c3-integrated', 'c3-independent-both', 'c4-functional'] };
    assert.equal(adjustmentEvent(event).scope, 'prompt');
    assert.throws(() => adjustmentEvent({ ...event, scope: 'shell' }));
    assert.throws(() => adjustmentEvent({ ...event, nextReleaseId: 'release-1' }));
    assert.throws(() => adjustmentEvent({ ...event, command: 'echo bad' }));
});
