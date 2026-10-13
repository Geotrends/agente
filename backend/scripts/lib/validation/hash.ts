import { createHash } from "node:crypto";
import { fail } from "./types.js";
const compare = (a: string, b: string): number => { const x = Array.from(a, c => c.codePointAt(0)!); const y = Array.from(b, c => c.codePointAt(0)!); for (let i = 0; i < Math.min(x.length, y.length); i++)
    if (x[i] !== y[i])
        return x[i] - y[i]; return x.length - y.length; };
export function canonical(value: unknown): string {
    const seen = new Set<object>();
    const serialize = (v: unknown): string => {
        if (v === null)
            return 'null';
        if (typeof v === 'boolean')
            return String(v);
        if (typeof v === 'number') {
            if (!Number.isFinite(v))
                fail('finite_number');
            return JSON.stringify(v);
        }
        if (typeof v === 'string') {
            if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v))
                fail('unicode_surrogate');
            return JSON.stringify(v);
        }
        if (typeof v !== 'object' || !v || seen.has(v))
            fail('json_type');
        seen.add(v);
        let out: string;
        if (Array.isArray(v)) {
            if (Object.keys(v).length !== v.length)
                fail('sparse_array');
            out = '[' + v.map(serialize).join(',') + ']';
        }
        else {
            if (Object.getPrototypeOf(v) !== Object.prototype)
                fail('json_object');
            out = '{' + Object.keys(v).sort(compare).map(k => serialize(k) + ':' + serialize((v as Record<string, unknown>)[k])).join(',') + '}';
        }
        seen.delete(v);
        return out;
    };
    return serialize(value);
}
export const bytesHash = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const contentHash = (value: unknown): string => bytesHash(canonical(value));
