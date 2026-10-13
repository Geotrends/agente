import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, symlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, contentHash, bytesHash } from "../scripts/lib/validation/hash.js";
import { artifact, readArtifact, writeImmutable, appendEvent, readLedger } from "../scripts/lib/validation/artifacts.js";
import { treeManifest } from "../scripts/lib/validation/identity.js";
test("hash incluye expectativas/fecha/aprobación/pasos; orden de claves estable, arrays exactos", () => {
    const source = { expected: ' texto ', at: '2026-10-10T00:00:00Z', approval: { name: 'Persona' }, steps: ['a', 'b'] };
    assert.equal(contentHash(source), contentHash({ steps: source.steps, approval: source.approval, at: source.at, expected: source.expected }));
    for (const altered of [{ ...source, expected: 'texto' }, { ...source, at: '2026-10-11T00:00:00Z' }, { ...source, approval: { name: 'Otra persona' } }, { ...source, steps: ['b', 'a'] }])
        assert.notEqual(contentHash(source), contentHash(altered));
    for (const value of [NaN, Infinity, undefined, new Date(), { x: undefined }])
        assert.throws(() => canonical(value));
    assert.equal(canonical({ '\u{10000}': 1, '\ue000': 2 }), '{"":2,"𐀀":1}');
});
test("refs comprueban bytes; traversal, symlink y secretos nunca pasan", async () => {
    const root = await mkdtemp(join(tmpdir(), 'validation-'));
    await writeFile(join(root, 'evidence.json'), '{}');
    const ref = await artifact(root, 'evidence.json', 'application/json');
    assert.equal((await readArtifact(root, ref)).toString(), '{}');
    await writeFile(join(root, 'evidence.json'), '{"changed":true}');
    await assert.rejects(readArtifact(root, ref));
    await writeFile(join(root, '.env'), 'private');
    await symlink(join(root, '.env'), join(root, 'link'));
    for (const p of ['../outside', '.env', 'link'])
        await assert.rejects(artifact(root, p, 'text/plain'));
    await assert.rejects(readArtifact(root, { ...ref, path: '/etc/passwd' }));
});
test("archivo inmutable y ledger append-only; output no entra al árbol, untracked sí", async () => {
    const root = await mkdtemp(join(tmpdir(), 'validation-tree-'));
    await mkdir(join(root, 'backend/src'), { recursive: true });
    await writeFile(join(root, 'backend/src/untracked.ts'), 'export const x=1;');
    await mkdir(join(root, 'backend/dist'), { recursive: true });
    await writeFile(join(root, 'backend/dist/out.js'), 'output');
    const a = await treeManifest(root);
    assert.equal(a.files.length, 1);
    await writeFile(join(root, 'backend/src/untracked.ts'), 'export const x=2;');
    assert.notEqual(a.treeHash, (await treeManifest(root)).treeHash);
    await writeImmutable(root, 'runs/a.json', { id: 'a' });
    await assert.rejects(writeImmutable(root, 'runs/a.json', { id: 'a', changed: true }));
    assert.equal(bytesHash(await readFile(join(root, 'runs/a.json'))).length, 64);
    await appendEvent(root, 'ledger', { id: 'one' });
    await appendEvent(root, 'ledger', { id: 'two' });
    await assert.rejects(appendEvent(root, 'ledger', { id: 'one' }));
    assert.deepEqual((await readLedger(root, 'ledger')).map(x => x.id), ['one', 'two']);
});
