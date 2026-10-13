/** Contratos offline SPEC006. Ninguna entrada se ejecuta como código. */
export type Json = null | boolean | number | string | Json[] | {
    [key: string]: Json;
};
export type PersonRef = {
    name: string;
    role: string;
};
export type ArtifactRef = {
    path: string;
    sha256: string;
    mediaType: string;
};
export type ResultType = "respondida" | "sin información" | "fuera de alcance" | "aclaración";
export class ValidationError extends Error {
    constructor(readonly code: string, readonly field = "", readonly exitCode: 1 | 2 = 1) { super(`${code}${field ? `: ${field}` : ''}`); }
}
export function fail(code: string, field = "", exitCode: 1 | 2 = 1): never { throw new ValidationError(code, field, exitCode); }
export function object(v: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype)
        fail('object');
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o))
        if (!allowed.includes(k))
            fail('unknown_field', k, 2);
    for (const k of required)
        if (!(k in o) || o[k] === null || o[k] === undefined)
            fail('required', k);
    return o;
}
export function text(v: unknown): string {
    if (typeof v !== 'string' || !v.trim() || /^(todo|tbd|pending|pendiente|n\/?a|unknown|por definir|sin asignar|test|prueba|example|ejemplo)$/i.test(v.trim()))
        fail('nonempty_real_text');
    return v;
}
export function id(v: unknown): string { const s = text(v); if (!/^[\p{L}\p{N}][\p{L}\p{N}._:-]*$/u.test(s))
    fail('stable_id'); return s; }
export function enumeration<T extends string>(v: unknown, values: readonly T[]): T { if (typeof v !== 'string' || !values.includes(v as T))
    fail('enum'); return v as T; }
export function version(v: unknown): 1 { if (v !== 1)
    fail('schema_version', 'schemaVersion', 2); return 1; }
export function sha(v: unknown): string { const s = text(v); if (!/^[a-f0-9]{64}$/.test(s))
    fail('sha256'); return s; }
export function civilDate(v: unknown): string {
    const s = text(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s)
        fail('civil_date');
    return s;
}
export function instant(v: unknown): string {
    const s = text(v);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(s))
        fail('instant_timezone');
    civilDate(s.slice(0, 10));
    if (!Number.isFinite(Date.parse(s)))
        fail('instant');
    return new Date(s).toISOString();
}
export function person(v: unknown): PersonRef { const o = object(v, ['name', 'role']); return { name: text(o.name), role: text(o.role) }; }
export function ref(v: unknown): ArtifactRef { const o = object(v, ['path', 'sha256', 'mediaType']); return { path: text(o.path), sha256: sha(o.sha256), mediaType: text(o.mediaType) }; }
export function list(v: unknown, min = 0): unknown[] { if (!Array.isArray(v) || v.length < min)
    fail('array'); return v; }
export function unique<T>(values: T[], key: (v: T) => string): void { const seen = new Set<string>(); for (const v of values) {
    const k = id(key(v));
    if (seen.has(k))
        fail('duplicate_id', k);
    seen.add(k);
} }
// Catalogo aprobado en specs del repositorio; se añade desde el lector, nunca desde JSON ciudadano.
const own = new Set(['RF-C3-VA-01', 'RF-C3-VA-02', 'RF-C3-VA-03', 'RF-C3-VA-04', 'RF-C3-VA-05', 'RF-C3-VA-06', 'RF-C4-PR-01', 'RF-C4-PR-02', 'RF-C4-PR-03', 'RF-C4-PR-04', 'RNF-C4-UI-02', 'RNF-C3-IN-03']);
export function requirement(v: unknown, approved: ReadonlySet<string> = own): string { const s = text(v); if (!approved.has(s))
    fail('unapproved_requirement', s); return s; }
export function finite(v: unknown): number { if (typeof v !== 'number' || !Number.isFinite(v))
    fail('finite_number'); return v; }
