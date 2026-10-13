import { randomUUID } from 'node:crypto';
import { matrixC4, coverageC4 } from './matrixC4.js';
import { matrixC3 } from './matrixC3.js';
import { approvalReceipt, verifyFreeze } from './freeze.js';
import { jsonArtifact, readArtifact } from './artifacts.js';
import { contentHash } from './hash.js';
import { object, version, id, ref, sha, instant, person, fail, type ArtifactRef, type PersonRef } from './types.js';
export async function checkC4(root: string, value: unknown, c3FreezeRef: ArtifactRef, approved = false, baseRef?: ArtifactRef) { const o = value as Record<string, unknown>; const c3Ref = ref(o.c3MatrixRef); const c3 = matrixC3(await jsonArtifact(root, c3Ref), false); await verifyFreeze(root, c3Ref, await jsonArtifact(root, c3FreezeRef), new Date()); if (baseRef && contentHash(baseRef) !== contentHash(c3.baseRef))
    fail('base_reference'); const matrix = matrixC4(value, c3, !approved); return { matrix, coverage: coverageC4(matrix) }; }
export async function freezeC4(root: string, matrixRef: ArtifactRef, approvalRef: ArtifactRef, c3FreezeRef: ArtifactRef, by: PersonRef, now = new Date()) {
    const { matrix, coverage } = await checkC4(root, await jsonArtifact(root, matrixRef), c3FreezeRef, true);
    const c3Freeze = await jsonArtifact(root, c3FreezeRef) as {
        frozenAt: string;
    };
    if (Date.parse(c3Freeze.frozenAt) >= now.getTime() || matrix.approval && Date.parse(c3Freeze.frozenAt) > Date.parse(matrix.approval.at))
        fail('c3_freeze_order');
    const a = approvalReceipt(await jsonArtifact(root, approvalRef));
    await readArtifact(root, a.humanEvidenceRef);
    if (contentHash(a.matrixRef) !== contentHash(matrixRef) || a.matrixContentHash !== contentHash(matrix) || !matrix.approval || contentHash(a.approvedBy) !== contentHash(matrix.approval.by) || instant(a.approvedAt) !== instant(matrix.approval.at) || Date.parse(a.approvedAt) > now.getTime())
        fail('approval_identity_or_order');
    person(by);
    return { schemaVersion: 1, id: 'freeze-' + randomUUID(), matrixRef, matrixContentHash: contentHash(matrix), frozenAt: now.toISOString(), by, c3FreezeRef, coverageSummary: coverage, approvalReceiptRef: approvalRef };
}
export async function verifyFreezeC4(root: string, matrixRef: ArtifactRef, value: unknown, runStart: Date) { const o = object(value, ['schemaVersion', 'id', 'matrixRef', 'matrixContentHash', 'frozenAt', 'by', 'c3FreezeRef', 'coverageSummary', 'approvalReceiptRef']); version(o.schemaVersion); id(o.id); ref(o.matrixRef); sha(o.matrixContentHash); instant(o.frozenAt); if (contentHash(o.matrixRef) !== contentHash(matrixRef) || Date.parse(String(o.frozenAt)) >= runStart.getTime())
    fail('freeze_order_or_ref'); const expected = await freezeC4(root, matrixRef, ref(o.approvalReceiptRef), ref(o.c3FreezeRef), person(o.by), new Date(String(o.frozenAt))); if (expected.matrixContentHash !== o.matrixContentHash || contentHash(expected.coverageSummary) !== contentHash(o.coverageSummary))
    fail('freeze_content_hash'); return expected; }
