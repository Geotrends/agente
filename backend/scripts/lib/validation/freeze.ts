import { randomUUID } from 'node:crypto';
import { object, version, id, sha, instant, person, ref, fail, type ArtifactRef, type PersonRef } from './types.js';
import { jsonArtifact, readArtifact } from './artifacts.js';
import { contentHash } from './hash.js';
import { matrixC3, inventory } from './matrixC3.js';
import { coverageC3, type Coverage } from './coverage.js';
export type ApprovalReceipt = {
    schemaVersion: 1;
    id: string;
    matrixRef: ArtifactRef;
    matrixContentHash: string;
    approvedBy: PersonRef;
    approvedAt: string;
    humanEvidenceRef: ArtifactRef;
};
export type FreezeReceipt = {
    schemaVersion: 1;
    id: string;
    matrixRef: ArtifactRef;
    matrixContentHash: string;
    frozenAt: string;
    by: PersonRef;
    baseRef: ArtifactRef;
    coverageSummary: Coverage;
    approvalReceiptRef: ArtifactRef;
};
export function approvalReceipt(value: unknown): ApprovalReceipt { const o = object(value, ['schemaVersion', 'id', 'matrixRef', 'matrixContentHash', 'approvedBy', 'approvedAt', 'humanEvidenceRef']); version(o.schemaVersion); id(o.id); ref(o.matrixRef); sha(o.matrixContentHash); person(o.approvedBy); instant(o.approvedAt); ref(o.humanEvidenceRef); return o as unknown as ApprovalReceipt; }
export async function checkC3(root: string, matrixValue: unknown, baseRef: ArtifactRef, approved = false): Promise<{
    matrix: ReturnType<typeof matrixC3>;
    coverage: Coverage;
}> {
    const matrix = matrixC3(matrixValue, !approved), coverage = coverageC3(matrix);
    if (contentHash(matrix.baseRef) !== contentHash(baseRef))
        fail('base_reference');
    const base = object(await jsonArtifact(root, baseRef), ['schemaVersion', 'gtpInventory']);
    version(base.schemaVersion);
    const gtps = inventory(base.gtpInventory);
    if (contentHash(gtps) !== contentHash(matrix.gtpInventory))
        fail('base_inventory');
    for (const r of [...matrix.rulesRefs, ...matrix.cases.flatMap(c => c.attack ? [c.attack.payloadRef, ...(c.attack.testDocumentRef ? [c.attack.testDocumentRef] : [])] : [])])
        await readArtifact(root, r);
    return { matrix, coverage };
}
export async function freezeMatrix(root: string, matrixRef: ArtifactRef, approvalRef: ArtifactRef, baseRef: ArtifactRef, by: PersonRef, now = new Date()): Promise<FreezeReceipt> {
    const { matrix, coverage } = await checkC3(root, await jsonArtifact(root, matrixRef), baseRef, true);
    const a = approvalReceipt(await jsonArtifact(root, approvalRef));
    await readArtifact(root, a.humanEvidenceRef);
    if (contentHash(a.matrixRef) !== contentHash(matrixRef) || a.matrixContentHash !== contentHash(matrix))
        fail('approval_hash');
    if (!matrix.approval || contentHash(matrix.approval.by) !== contentHash(a.approvedBy) || instant(matrix.approval.at) !== instant(a.approvedAt))
        fail('approval_identity');
    if (Date.parse(a.approvedAt) > now.getTime())
        fail('approval_after_freeze');
    person(by);
    return { schemaVersion: 1, id: 'freeze-' + randomUUID(), matrixRef, matrixContentHash: contentHash(matrix), frozenAt: now.toISOString(), by, baseRef, coverageSummary: coverage, approvalReceiptRef: approvalRef };
}
export async function verifyFreeze(root: string, matrixRef: ArtifactRef, value: unknown, runStart: Date): Promise<FreezeReceipt> {
    const o = object(value, ['schemaVersion', 'id', 'matrixRef', 'matrixContentHash', 'frozenAt', 'by', 'baseRef', 'coverageSummary', 'approvalReceiptRef']);
    version(o.schemaVersion);
    id(o.id);
    ref(o.matrixRef);
    sha(o.matrixContentHash);
    instant(o.frozenAt);
    person(o.by);
    ref(o.baseRef);
    ref(o.approvalReceiptRef);
    if (contentHash(o.matrixRef) !== contentHash(matrixRef) || Date.parse(String(o.frozenAt)) >= runStart.getTime())
        fail('freeze_order_or_ref');
    const expected = await freezeMatrix(root, matrixRef, ref(o.approvalReceiptRef), ref(o.baseRef), person(o.by), new Date(String(o.frozenAt)));
    if (expected.matrixContentHash !== o.matrixContentHash || contentHash(expected.coverageSummary) !== contentHash(o.coverageSummary))
        fail('freeze_content_hash');
    return o as unknown as FreezeReceipt;
}
