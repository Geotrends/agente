import { readFile } from "node:fs/promises";
import { fail, type Json } from "./types.js";
/** Recursive-descent JSON parser: detects duplicate decoded keys before JSON.parse can erase them. */
export function parseJson(raw: string): Json {
    if (raw.charCodeAt(0) === 0xfeff)
        fail('utf8_bom', '', 2);
    let pos = 0;
    const ws = () => { while (/[\x20\t\r\n]/.test(raw[pos] ?? '!'))
        pos++; };
    const string = (): string => {
        const start = pos++;
        let escaped = false;
        while (pos < raw.length) {
            const c = raw[pos++];
            if (c === '"' && !escaped) {
                try {
                    return JSON.parse(raw.slice(start, pos)) as string;
                }
                catch {
                    fail('json_string', '', 2);
                }
            }
            if (c === '\\' && !escaped)
                escaped = true;
            else
                escaped = false;
        }
        return fail('json_string', '', 2);
    };
    const value = (depth = 0): Json => {
        if (depth > 100)
            fail('json_depth', '', 2);
        ws();
        const c = raw[pos];
        if (c === '"')
            return string();
        if (c === '{') {
            pos++;
            ws();
            const result: Record<string, Json> = {};
            const keys = new Set<string>();
            if (raw[pos] === '}') {
                pos++;
                return result;
            }
            while (true) {
                ws();
                if (raw[pos] !== '"')
                    fail('json_key', '', 2);
                const key = string();
                if (keys.has(key))
                    fail('duplicate_key', key, 2);
                if (['__proto__', 'constructor', 'prototype'].includes(key))
                    fail('unsafe_key', key, 2);
                keys.add(key);
                ws();
                if (raw[pos++] !== ':')
                    fail('json_colon', '', 2);
                result[key] = value(depth + 1);
                ws();
                const end = raw[pos++];
                if (end === '}')
                    return result;
                if (end !== ',')
                    fail('json_object', '', 2);
            }
        }
        if (c === '[') {
            pos++;
            ws();
            const result: Json[] = [];
            if (raw[pos] === ']') {
                pos++;
                return result;
            }
            while (true) {
                result.push(value(depth + 1));
                ws();
                const end = raw[pos++];
                if (end === ']')
                    return result;
                if (end !== ',')
                    fail('json_array', '', 2);
            }
        }
        for (const [word, result] of [['true', true], ['false', false], ['null', null]] as const)
            if (raw.slice(pos, pos + word.length) === word) {
                pos += word.length;
                return result;
            }
        const match = raw.slice(pos).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
        if (!match)
            fail('json_value', '', 2);
        pos += match[0].length;
        const number = Number(match[0]);
        if (!Number.isFinite(number))
            fail('finite_number', '', 2);
        return number;
    };
    const result = value();
    ws();
    if (pos !== raw.length)
        fail('json_trailing', '', 2);
    return result;
}
export async function readJson(path: string): Promise<Json> {
    const b = await readFile(path);
    const s = new TextDecoder('utf-8', { fatal: true }).decode(b);
    return parseJson(s);
}
