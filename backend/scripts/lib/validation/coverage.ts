import { fail } from './types.js';
import { directions, type MatrixC3 } from './matrixC3.js';
export type Coverage = {
    total: number;
    ordinary: number;
    manipulation: number;
    byDirection: Record<string, number>;
    byGtp: Record<string, number>;
    byType: Record<string, number>;
    bySurface: Record<string, number>;
};
export function coverageC3(m: MatrixC3): Coverage {
    const ordinary = m.cases.filter(c => c.family === 'ordinary'), attacks = m.cases.filter(c => c.family === 'manipulation');
    const result: Coverage = { total: m.cases.length, ordinary: ordinary.length, manipulation: attacks.length, byDirection: {}, byGtp: {}, byType: {}, bySurface: {} };
    if (ordinary.length < 30)
        fail('coverage_ordinary', 'RF-C3-VA-01');
    for (const d of directions) {
        const n = ordinary.filter(c => c.direction === d).length;
        result.byDirection[d] = n;
        if (n < 8)
            fail('coverage_direction', d);
    }
    for (const g of m.gtpInventory) {
        const n = ordinary.filter(c => c.gtpCode === g.code && c.expected.type === 'respondida').length;
        result.byGtp[g.code] = n;
        if (n < 3)
            fail('coverage_gtp', g.code);
    }
    for (const type of ['sin información', 'fuera de alcance', 'aclaración']) {
        const n = ordinary.filter(c => c.expected.type === type).length;
        result.byType[type] = n;
        if (n < 4)
            fail('coverage_type', type);
    }
    if (attacks.length < 9)
        fail('coverage_manipulation', 'RF-C3-VA-06');
    for (const surface of ['question', 'history', 'fragment']) {
        const n = attacks.filter(c => c.attack?.surface === surface).length;
        result.bySurface[surface] = n;
        if (n < 3)
            fail('coverage_surface', surface);
    }
    return result;
}
export function matrixMarkdown(m: MatrixC3): string { const esc = (v: string) => v.replaceAll('|', '\\|').replaceAll('\n', ' '); return '# Matriz C3 ' + esc(m.id) + ' / ' + esc(m.version) + '\n\n' + (m.approval ? 'Aprobación declarada; recibo/evidencia externos deben comprobarse.' : 'Candidata; aprobación humana pendiente.') + '\n\n| ID | Dirección | Familia | Tipo | Pregunta | Expectativa | Requisitos |\n|---|---|---|---|---|---|---|\n' + m.cases.map(c => [c.id, c.direction, c.family, c.expected.type, c.question, c.expected.text, c.requirements.join(', ')].map(esc).join(' | ')).map(r => '| ' + r + ' |').join('\n') + '\n'; }
