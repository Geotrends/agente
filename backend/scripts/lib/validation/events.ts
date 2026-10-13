import { object, version, id, instant, enumeration, text, requirement, list, person, fail } from "./types.js";
import { appendEvent, readLedger } from "./artifacts.js";
export function adjustmentEvent(value: unknown): Record<string, unknown> {
    const o = object(value, ['schemaVersion', 'id', 'at', 'scope', 'previousReleaseId', 'nextReleaseId', 'description', 'requirementIds', 'owner', 'invalidatedRunIds', 'requiredReruns']);
    version(o.schemaVersion);
    id(o.id);
    instant(o.at);
    enumeration(o.scope, ['prompt', 'retrieval', 'base', 'c3', 'c4', 'matrix', 'config']);
    id(o.previousReleaseId);
    id(o.nextReleaseId);
    if (o.previousReleaseId === o.nextReleaseId)
        fail('adjustment_release');
    text(o.description);
    list(o.requirementIds, 1).forEach(v => requirement(v));
    person(o.owner);
    list(o.invalidatedRunIds).forEach(id);
    list(o.requiredReruns, 1).forEach(text);
    return o;
}
export async function recordAdjustment(root: string, value: unknown): Promise<void> { await appendEvent(root, 'events', adjustmentEvent(value)); }
export async function events(root: string): Promise<Record<string, unknown>[]> { const result = await readLedger(root, 'events'); return result.sort((a, b) => String(a.at).localeCompare(String(b.at))); }
