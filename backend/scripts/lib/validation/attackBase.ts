/** Persistent cleanup obligations for an explicitly isolated, synthetic KB copy. */
import { randomUUID } from 'node:crypto';
import type { Pool } from '../../../src/kb/db.js';
import { borrarPuntosElemento, contarPuntos } from '../../../src/kb/indexer.js';
import { vectorBm25 } from '../../../src/kb/sparse.js';
import { abortable } from '../../../src/chat/modelRouting.js';
import { qdrant, aliasKb } from '../../../src/services/qdrant.js';
import { appendEvent, readLedger, writeImmutable, artifact, jsonArtifact } from './artifacts.js';
import { person, ref, text, fail, type ArtifactRef, type PersonRef } from './types.js';
import { contentHash } from './hash.js';
export type AttackScope = {
    databaseName: string;
    alias: string;
    officialAlias: string;
    baseRef: ArtifactRef;
    copyRef: ArtifactRef;
    syntheticOnly: true;
};
export type AttackPorts = {
    install: (key: string) => Promise<void>;
    snapshot: (key: string) => Promise<{
        documentIds: string[];
        pointIds: string[];
    }>;
    remove: (key: string) => Promise<void>;
    search: (key: string) => Promise<string[]>;
};
export function assertAttackScope(s: AttackScope): void { if (s.syntheticOnly !== true || s.alias === s.officialAlias || s.alias === 'kb_chunks' || !/^kbprueba_[a-f0-9]+$|^validation_[a-z0-9_]+$/.test(s.alias) || !/^kb_prueba_[a-f0-9]+$|^validation_[a-z0-9_]+$/.test(s.databaseName))
    fail('attack_isolation'); ref(s.baseRef); ref(s.copyRef); }
export async function kbAttackPorts(db: Pool, scope: AttackScope, install: (key: string) => Promise<void>): Promise<AttackPorts> {
    assertAttackScope(scope);
    const actual = (await db.query('SELECT current_database() AS name')).rows[0].name;
    if (actual !== scope.databaseName)
        fail('attack_database');
    const ids = async (key: string): Promise<string[]> => (await db.query<{
        id: string;
    }>('SELECT id FROM kb.kb_elemento WHERE clave=$1', [key])).rows.map(r => r.id);
    const exists = async () => (await qdrant().getAliases()).aliases.some(a => a.alias_name === scope.alias);
    const points = async (key: string): Promise<{
        id: string;
        documentId: string;
    }[]> => { if (!await exists())
        return []; const { points } = await qdrant().scroll(scope.alias, { filter: { must: [{ key: 'url', match: { value: key } }] }, limit: 10000, with_payload: true }); return points.map(p => ({ id: String(p.id), documentId: String(p.payload?.elemento_id) })); };
    return { install: async (key) => { if (aliasKb() !== scope.alias)
            fail('attack_alias'); await install(key); if (aliasKb() !== scope.alias)
            fail('attack_alias_changed'); }, snapshot: async (key) => ({ documentIds: await ids(key), pointIds: (await points(key)).map(p => p.id) }), search: async (key) => { if (!await exists())
            return []; const result = await qdrant().query(scope.alias, { query: vectorBm25(key, 140), using: 'bm25', filter: { must: [{ key: 'url', match: { value: key } }, { key: 'estado', match: { value: 'publicado' } }] }, limit: 10000, with_payload: false }); return result.points.map(p => String(p.id)); }, remove: async (key) => {
            // Discover orphaned points too: a crash may have removed SQL first.
            const documentIds = [...new Set([...(await ids(key)), ...(await points(key)).map(p => p.documentId)])];
            for (const documentId of documentIds) {
                await borrarPuntosElemento(documentId, scope.alias);
                if (await contarPuntos(scope.alias, documentId))
                    fail('attack_points_remaining');
            }
            await db.query('DELETE FROM kb.kb_elemento WHERE clave=$1', [key]);
        } };
}
export class AttackBase {
    constructor(private root: string, private scope: AttackScope, private ports: AttackPorts, private by: PersonRef) { assertAttackScope(scope); person(by); }
    private async pending(): Promise<Record<string, unknown>[]> { const events = await readLedger(this.root, 'attack-ledger'); const cleaned = new Set(events.filter(e => e.kind === 'cleanup-complete').map(e => e.obligationId)); return events.filter(e => e.kind === 'cleanup-pending' && !cleaned.has(e.id)); }
    async reconcile(): Promise<ArtifactRef[]> { const receipts: ArtifactRef[] = []; for (const obligation of await this.pending())
        receipts.push(await this.cleanup(obligation)); return receipts; }
    private async cleanup(obligation: Record<string, unknown>): Promise<ArtifactRef> {
        if (contentHash(obligation.scope) !== contentHash(this.scope))
            fail('cleanup_scope');
        const key = text(obligation.documentKey);
        const before = await this.ports.snapshot(key);
        await this.ports.remove(key);
        const after = await this.ports.snapshot(key), retrievable = await this.ports.search(key);
        if (after.documentIds.length || after.pointIds.length || retrievable.length)
            fail('cleanup_remaining');
        const at = new Date().toISOString();
        const path = `cleanup/${String(obligation.id)}.json`;
        let receipt: ArtifactRef;
        try {
            receipt = await artifact(this.root, path, 'application/json');
            const existing = await jsonArtifact(this.root, receipt) as Record<string, unknown>;
            if (existing.id !== 'cleanup-' + String(obligation.id) || existing.documentKey !== key || contentHash(existing.scope) !== contentHash(this.scope))
                fail('cleanup_receipt_identity');
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                throw error;
            receipt = await writeImmutable(this.root, path, { schemaVersion: 1, id: 'cleanup-' + String(obligation.id), scope: this.scope, documentKey: key, before, after, retrievable, at, by: this.by });
        }
        await appendEvent(this.root, 'attack-ledger', { id: 'cleaned-' + String(obligation.id), kind: 'cleanup-complete', obligationId: obligation.id, receiptRef: receipt, at });
        return receipt;
    }
    async execute<T>(documentKey: string, work: (exposed: (pointIds: string[]) => void) => Promise<T>, signal?: AbortSignal): Promise<{
        result: T;
        cleanupRef: ArtifactRef;
    }> {
        if ((await this.pending()).length)
            fail('cleanup_reconcile_required');
        const obligation = { schemaVersion: 1, id: 'attack-' + randomUUID(), kind: 'cleanup-pending', documentKey: text(documentKey), scope: this.scope, at: new Date().toISOString() };
        await appendEvent(this.root, 'attack-ledger', obligation);
        const controller = new AbortController();
        const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
        let exposure = false, result: T;
        const cancel = () => controller.abort(new Error('attack_cancelled'));
        signal?.addEventListener('abort', cancel, { once: true });
        process.once('SIGTERM', cancel);
        try {
            if (signal?.aborted)
                fail('attack_cancelled');
            await this.ports.install(documentKey);
            const installed = await this.ports.snapshot(documentKey);
            if (!installed.documentIds.length || !installed.pointIds.length)
                fail('attack_not_indexed');
            if (combined.aborted)
                fail('attack_cancelled');
            result = await abortable(work(ids => { if (ids.length && ids.every(id => installed.pointIds.includes(id)))
                exposure = true; }), combined);
            if (!exposure)
                fail('attack_not_exposed');
            if (signal?.aborted)
                fail('attack_cancelled');
        }
        catch (error) {
            await this.cleanup(obligation);
            throw error;
        }
        finally {
            signal?.removeEventListener('abort', cancel);
            process.removeListener('SIGTERM', cancel);
        }
        // Keep obligation durable until removal receipt is published; failed work cleans too below.
        const cleanupRef = await this.cleanup(obligation);
        return { result: result!, cleanupRef };
    }
    async cleanupPending(): Promise<ArtifactRef[]> { return this.reconcile(); }
}
