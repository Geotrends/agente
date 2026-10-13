import { readdir, readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { safePath, readArtifact } from "./artifacts.js";
import { contentHash, bytesHash } from "./hash.js";
import { object, version, id, instant, sha, text, list, ref, unique, fail, type ArtifactRef } from "./types.js";
export type TreeManifest = {
    schemaVersion: 1;
    files: {
        path: string;
        sha256: string;
    }[];
    treeHash: string;
};
const roots = ['backend/src', 'backend/scripts', 'backend/config', 'backend/migrations', 'backend/db', 'frontend/app', 'frontend/chat', 'frontend/shared', 'frontend/smart', 'frontend/widget', 'frontend/scripts', 'frontend/test/pr', 'frontend/public/brand', 'frontend/public/embed', 'web_scraper/scraper', '.github/workflows'];
const extras = ['backend/package.json', 'backend/package-lock.json', 'frontend/package.json', 'frontend/package-lock.json', 'backend/Dockerfile', 'frontend/Dockerfile', 'web_scraper/Dockerfile', 'frontend/nginx.conf', 'docker-compose.yml', 'web_scraper/requirements.txt', 'frontend/playwright.acceptance.config.ts', 'backend/Dockerfile.validation', 'docker-compose.validation.yml'];
const excluded = /(^|\/)(node_modules|dist|build|out|\.next|\.cache|__pycache__|coverage|test-results|playwright-report|aceptacion|\.aws|\.env[^/]*|var|data)(\/|$)|\.tmp$|\.log$/;
export async function treeManifest(root: string): Promise<TreeManifest> {
    const files: TreeManifest['files'] = [];
    const visit = async (path: string): Promise<void> => {
        if (excluded.test(path))
            return;
        let stat;
        try {
            stat = await lstat(join(root, path));
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                return;
            throw error;
        }
        if (stat.isSymbolicLink())
            fail('tree_symlink', path, 2);
        if (stat.isDirectory()) {
            for (const name of (await readdir(join(root, path))).sort())
                await visit(`${path}/${name}`);
            return;
        }
        if (!stat.isFile())
            fail('tree_file', path, 2);
        const bytes = await readFile(await safePath(root, path));
        // Reject private key / known cloud credential material without including the content in errors.
        if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:AKIA|ASIA)[A-Z0-9]{16}/.test(bytes.toString('utf8')))
            fail('tree_secret', path, 2);
        files.push({ path, sha256: bytesHash(bytes) });
    };
    for (const path of [...roots, ...extras])
        await visit(path);
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return { schemaVersion: 1, files, treeHash: contentHash(files) };
}
export type ReleaseManifest = {
    schemaVersion: 1;
    releaseId: string;
    createdAt: string;
    gitCommit: string;
    treeManifestRef: ArtifactRef;
    treeHash: string;
    backendImageDigest: string;
    frontendImageDigest: string;
    bundleHash: string;
    launcherHash: string;
    lockfiles: ArtifactRef[];
    promptHash: string;
    generationConfigHash: string;
    enabledModels: string[];
    baseRef: ArtifactRef;
    calibrationRef: ArtifactRef;
    contactsRevision: string;
    policyVersion: string;
    tariffsHash: string;
    publicConfigHash: string;
    environmentRef: ArtifactRef;
    matrixRefs: ArtifactRef[];
};
const fields = ['schemaVersion', 'releaseId', 'createdAt', 'gitCommit', 'treeManifestRef', 'treeHash', 'backendImageDigest', 'frontendImageDigest', 'bundleHash', 'launcherHash', 'lockfiles', 'promptHash', 'generationConfigHash', 'enabledModels', 'baseRef', 'calibrationRef', 'contactsRevision', 'policyVersion', 'tariffsHash', 'publicConfigHash', 'environmentRef', 'matrixRefs'];
export function releaseManifest(value: unknown): ReleaseManifest {
    const o = object(value, fields);
    version(o.schemaVersion);
    id(o.releaseId);
    instant(o.createdAt);
    if (!/^[a-f0-9]{40}$/.test(text(o.gitCommit)))
        fail('git_commit');
    for (const field of ['treeHash', 'bundleHash', 'launcherHash', 'promptHash', 'generationConfigHash', 'tariffsHash', 'publicConfigHash'])
        sha(o[field]);
    for (const field of ['backendImageDigest', 'frontendImageDigest'])
        if (!/^sha256:[a-f0-9]{64}$/.test(text(o[field])))
            fail('image_digest', field);
    for (const field of ['treeManifestRef', 'baseRef', 'calibrationRef', 'environmentRef'])
        ref(o[field]);
    for (const field of ['lockfiles', 'matrixRefs'])
        list(o[field], 1).forEach(ref);
    const models = list(o.enabledModels, 2).map(text);
    if (models.length !== 2 || models.some(m => !['openai.gpt-oss-20b-1:0', 'openai.gpt-oss-120b-1:0'].includes(m)))
        fail('enabled_models');
    unique(models, x => x);
    text(o.contactsRevision);
    text(o.policyVersion);
    return o as unknown as ReleaseManifest;
}
export async function verifyRelease(root: string, value: unknown): Promise<ReleaseManifest> {
    const r = releaseManifest(value);
    for (const reference of [r.treeManifestRef, r.baseRef, r.calibrationRef, r.environmentRef, ...r.lockfiles, ...r.matrixRefs])
        await readArtifact(root, reference);
    const { parseJson } = await import('./readJson.js');
    const manifest = object(parseJson((await readArtifact(root, r.treeManifestRef)).toString('utf8')), ['schemaVersion', 'files', 'treeHash']);
    version(manifest.schemaVersion);
    const files = list(manifest.files, 1).map(v => { const o = object(v, ['path', 'sha256']); return { path: text(o.path), sha256: sha(o.sha256) }; });
    unique(files, x => x.path);
    if (contentHash(files) !== r.treeHash || manifest.treeHash !== r.treeHash)
        fail('tree_hash');
    const environment = object(parseJson((await readArtifact(root, r.environmentRef)).toString('utf8')), ['schemaVersion', 'id', 'os', 'osVersion', 'observedAt', 'executionClass', 'identity', 'evidenceRefs']);
    version(environment.schemaVersion);
    id(environment.id);
    text(environment.os);
    text(environment.osVersion);
    instant(environment.observedAt);
    if (!['real', 'controlled'].includes(String(environment.executionClass)))
        fail('environment_class');
    const fields = ['gitCommit', 'treeHash', 'backendImageDigest', 'frontendImageDigest', 'bundleHash', 'launcherHash', 'lockfiles', 'promptHash', 'generationConfigHash', 'enabledModels', 'baseRef', 'calibrationRef', 'contactsRevision', 'policyVersion', 'tariffsHash', 'publicConfigHash'];
    const observed = object(environment.identity, fields);
    for (const field of fields)
        if (contentHash(observed[field]) !== contentHash((r as unknown as Record<string, unknown>)[field]))
            fail('environment_identity', field);
    for (const reference of list(environment.evidenceRefs, 1))
        await readArtifact(root, reference);
    return r;
}
