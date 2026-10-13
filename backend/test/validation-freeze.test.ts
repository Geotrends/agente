import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { freezeMatrix, verifyFreeze } from '../scripts/lib/validation/freeze.js';
import { writeImmutable } from '../scripts/lib/validation/artifacts.js';
import { contentHash } from '../scripts/lib/validation/hash.js';
import { c3Fixture, personFixture } from './validation-support.js';
test('freeze verifica aprobación ligada a matriz completa, fecha efectiva e inmutabilidad', async () => {
    const root = await mkdtemp(join(tmpdir(), 'validation-freeze-'));
    const base = await writeImmutable(root, 'base.json', { schemaVersion: 1, gtpInventory: c3Fixture().gtpInventory });
    const m = c3Fixture();
    m.baseRef = base;
    const fixture = await writeImmutable(root, 'fixture.json', { fixture: 'synthetic payload' });
    m.rulesRefs = [fixture];
    for (const c of m.cases)
        if (c.attack) {
            c.attack.payloadRef = fixture;
            if (c.attack.testDocumentRef)
                c.attack.testDocumentRef = fixture;
        }
    const matrixRef = await writeImmutable(root, 'c3.json', m);
    const evidence = await writeImmutable(root, 'human-review.json', { fixture: 'synthetic human evidence' });
    const approval = { schemaVersion: 1, id: 'approval-1', matrixRef, matrixContentHash: contentHash(m), approvedBy: personFixture, approvedAt: m.approval!.at, humanEvidenceRef: evidence };
    const approvalRef = await writeImmutable(root, 'approval.json', approval);
    const receipt = await freezeMatrix(root, matrixRef, approvalRef, base, personFixture, new Date('2026-10-11T01:00:00Z'));
    assert.equal(receipt.matrixContentHash, contentHash(m));
    await verifyFreeze(root, matrixRef, receipt, new Date('2026-10-11T01:00:01Z'));
    await assert.rejects(verifyFreeze(root, matrixRef, receipt, new Date(receipt.frozenAt)));
    const wrong = await writeImmutable(root, 'wrong.json', { ...approval, matrixContentHash: 'a'.repeat(64) });
    await assert.rejects(freezeMatrix(root, matrixRef, wrong, base, personFixture, new Date('2026-10-11T01:00:00Z')));
    await assert.rejects(freezeMatrix(root, matrixRef, approvalRef, base, personFixture, new Date('2026-10-09T00:00:00Z')));
    await assert.rejects(writeImmutable(root, 'c3.json', { ...m, version: 'new' }));
});
