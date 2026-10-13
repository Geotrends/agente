import { lstat, realpath, readFile, mkdir, open, link, unlink, readdir } from "node:fs/promises";
import { resolve, relative, dirname, isAbsolute, sep, join } from "node:path";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { bytesHash, canonical } from "./hash.js";
import { parseJson } from "./readJson.js";
import { fail, ref, type ArtifactRef } from "./types.js";
const secret = /(^|\/)(?:\.env[^/]*|\.aws|\.ssh|credentials|secrets?)(\/|$)|\.(?:pem|key|p12)$/i;
export async function safePath(root: string, path: string, write = false): Promise<string> {
    if (isAbsolute(path) || path.includes('\\') || path.split('/').some(p => p === '..' || p === '.' || !p) || secret.test(path))
        fail('unsafe_path', '', 2);
    const base = await realpath(root);
    const target = resolve(base, path);
    if (relative(base, target).startsWith('..' + sep))
        fail('unsafe_path', '', 2);
    let current = base;
    for (const part of path.split('/')) {
        current = join(current, part);
        try {
            const stat = await lstat(current);
            if (stat.isSymbolicLink())
                fail('symlink', '', 2);
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT' && write)
                break;
            throw error;
        }
    }
    return target;
}
export async function artifact(root: string, path: string, mediaType: string): Promise<ArtifactRef> {
    const file = await safePath(root, path);
    const h = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        if (!(await h.stat()).isFile())
            fail('artifact_file', '', 2);
        return { path, sha256: bytesHash(await h.readFile()), mediaType };
    }
    finally {
        await h.close();
    }
}
export async function readArtifact(root: string, value: unknown): Promise<Buffer> { const r = ref(value); const p = await safePath(root, r.path); const h = await open(p, constants.O_RDONLY | constants.O_NOFOLLOW); try {
    if (!(await h.stat()).isFile())
        fail('artifact_file', '', 2);
    const b = await h.readFile();
    if (bytesHash(b) !== r.sha256)
        fail('artifact_hash', r.path);
    return b;
}
finally {
    await h.close();
} }
export async function jsonArtifact(root: string, value: unknown): Promise<unknown> { return parseJson(new TextDecoder('utf-8', { fatal: true }).decode(await readArtifact(root, value))); }
export async function writeImmutable(root: string, path: string, value: unknown): Promise<ArtifactRef> { return writeBytesImmutable(root, path, Buffer.from(canonical(value) + '\n'), 'application/json'); }
export async function writeTextImmutable(root: string, path: string, text: string): Promise<ArtifactRef> { return writeBytesImmutable(root, path, Buffer.from(text), 'text/markdown'); }
async function writeBytesImmutable(root: string, path: string, bytes: Buffer, mediaType: string): Promise<ArtifactRef> {
    const target = await safePath(root, path, true);
    await mkdir(dirname(target), { recursive: true });
    await safePath(root, path, true);
    const tmp = join(dirname(target), `.validation-${randomUUID()}.tmp`);
    const h = await open(tmp, 'wx', 0o600);
    try {
        await h.writeFile(bytes);
        await h.sync();
    }
    finally {
        await h.close();
    }
    // link is atomic and fails EEXIST; rename alone could overwrite a concurrent writer.
    try {
        await link(tmp, target);
    }
    finally {
        await unlink(tmp);
    }
    return artifact(root, path, mediaType);
}
export async function appendEvent(root: string, ledger: string, event: Record<string, unknown>): Promise<ArtifactRef> {
    const { id } = await import('./types.js');
    const eventId = id(event.id);
    return writeImmutable(root, `${ledger}/${eventId}.json`, event);
}
export async function readLedger(root: string, ledger: string): Promise<Record<string, unknown>[]> {
    const dir = await safePath(root, ledger, true);
    let names: string[];
    try {
        names = await readdir(dir);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            return [];
        throw error;
    }
    const events: Record<string, unknown>[] = [];
    for (const name of names.filter(n => n.endsWith('.json')).sort()) {
        const file = await safePath(root, `${ledger}/${name}`);
        events.push(parseJson(await readFile(file, 'utf8')) as Record<string, unknown>);
    }
    return events;
}
