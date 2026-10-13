import { object, version, id, text, enumeration, finite, ref, fail, type ArtifactRef } from './types.js';
export type ExecutionEnvironment = {
    schemaVersion: 1;
    id: string;
    os: string;
    osVersion: string;
    browser: string;
    browserVersion: string;
    device: string;
    deviceKind: 'physical' | 'emulated';
    viewport: {
        width: number;
        height: number;
    };
    screenReader: {
        name: string;
        version: string;
    } | null;
    hostUrl: string;
    chatUrl: string;
    connection: 'real' | 'stub';
    evidenceRef: ArtifactRef;
};
export function executionEnvironment(value: unknown): ExecutionEnvironment { const o = object(value, ['schemaVersion', 'id', 'os', 'osVersion', 'browser', 'browserVersion', 'device', 'deviceKind', 'viewport', 'screenReader', 'hostUrl', 'chatUrl', 'connection', 'evidenceRef'], ['schemaVersion', 'id', 'os', 'osVersion', 'browser', 'browserVersion', 'device', 'deviceKind', 'viewport', 'hostUrl', 'chatUrl', 'connection', 'evidenceRef']); version(o.schemaVersion); id(o.id); for (const k of ['os', 'osVersion', 'browser', 'browserVersion', 'device'])
    text(o[k]); enumeration(o.deviceKind, ['physical', 'emulated']); enumeration(o.connection, ['real', 'stub']); const viewport = object(o.viewport, ['width', 'height']); for (const v of Object.values(viewport))
    if (!Number.isSafeInteger(finite(v)) || Number(v) < 1)
        fail('viewport'); if (o.screenReader !== null && o.screenReader !== undefined) {
    const r = object(o.screenReader, ['name', 'version']);
    text(r.name);
    text(r.version);
} for (const k of ['hostUrl', 'chatUrl']) {
    const url = new URL(text(o[k]));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || o.connection === 'real' && url.protocol !== 'https:')
        fail('environment_url');
} ref(o.evidenceRef); return o as unknown as ExecutionEnvironment; }
export function assertRealEnvironment(e: ExecutionEnvironment, environment: 'desktop' | 'mobile', reader = false): void { if (e.connection !== 'real' || e.deviceKind !== 'physical')
    fail('physical_real_evidence_pending', environment); if (reader && !e.screenReader)
    fail('reader_evidence_pending'); }
