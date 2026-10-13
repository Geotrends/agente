import { expect, type Page } from '@playwright/test';
import type { CaseC4 } from '../../../backend/scripts/lib/validation/matrixC4';
import type { MatrixC3 } from '../../../backend/scripts/lib/validation/matrixC3';
export type PrTarget = {
    hostUrl: string;
    chatUrl: string;
};
export async function runFlow(page: Page, row: CaseC4, c3: MatrixC3, target: PrTarget) {
    const checks: string[] = [];
    const defaults: Record<string, string[]> = { category: ['ecosystems', 'animal', 'environment', 'uncertain'], rating: ['authorized', 'anonymous'], 'new-conversation': ['confirmed', 'cancelled'] };
    const variants = row.variants?.length ? row.variants : (defaults[row.flow] ?? ['anonymous']);
    for (const variant of variants) {
        await page.goto(target.hostUrl);
        await page.locator('button.geobot-w-btn').click();
        const f = page.frameLocator('iframe[title="Conversación con Geobot"]');
        await expect(f.getByRole('button', { name: 'Autorizo', exact: true })).toBeVisible();
        if (row.flow === 'emergency') {
            await f.getByRole('button', { name: 'Emergencia o situación en curso' }).click();
            await expect(f.getByRole('region', { name: 'Canales de atención inmediata' })).toBeVisible();
            await expect(f.getByLabel('Pregunta')).toBeDisabled();
            await f.getByRole('button', { name: 'Continuar con la orientación' }).click();
            await expect(f.getByRole('button', { name: 'No autorizo', exact: true })).toBeVisible();
            checks.push('emergency-local');
            continue;
        }
        const authorized = variant === 'authorized' || row.flow === 'rating' && variant !== 'anonymous';
        await f.getByRole('button', { name: authorized ? 'Autorizo' : 'No autorizo', exact: true }).click();
        const category = variant === 'ecosystems' ? 'Ecosistemas' : variant === 'animal' ? 'Bienestar Animal' : variant === 'environment' ? 'Gestión Ambiental' : 'No estoy seguro';
        await f.getByRole('button', { name: category, exact: true }).click();
        await expect(f.getByLabel('Pregunta')).toBeEnabled();
        if (row.flow === 'category') {
            await expect(f.getByRole('button', { name: category, exact: true })).toHaveAttribute('aria-pressed', 'true');
            checks.push('category-' + variant);
            continue;
        }
        const source = row.flow === 'faq' ? c3.cases.find(c => c.id === row.c3CaseId) : undefined;
        if (row.flow === 'faq' && !source)
            throw new Error('faq_source');
        const question = source?.question ?? (row.flow === 'functional-limit' ? (variant === 'decision' ? 'Decide oficialmente mi solicitud' : 'Radica oficialmente mi solicitud') : row.flow === 'c3-failure' ? 'Consulta sintética de indisponibilidad o espera' : 'Consulta sintética de orientación institucional');
        const request = page.waitForRequest(r => new URL(r.url()).origin === new URL(target.chatUrl).origin && r.url().endsWith('/api/chat') && r.method() === 'POST');
        await f.getByLabel('Pregunta').fill(question);
        await f.getByRole('button', { name: 'Enviar', exact: true }).click();
        const sent = await request;
        const payload = sent.postDataJSON();
        if (!authorized) {
            expect(payload).not.toHaveProperty('historial');
            expect(payload).not.toHaveProperty('conversationId');
        }
        if (row.flow === 'c3-failure') {
            if (variant === 'waiting') {
                await expect(f.getByRole('status')).toContainText('Geobot está buscando');
                await expect(f.getByLabel('Pregunta')).toBeDisabled();
            }
            await expect(f.getByRole('alert', { name: /No fue posible responder/ })).toBeVisible({ timeout: 50000 });
            await expect(f.getByRole('alert', { name: /No fue posible responder/ })).not.toContainText(/SELECT|stack|gpt-oss|ERROR_INTERNO/);
            checks.push('failure-' + variant);
            continue;
        }
        await expect(f.getByLabel('Pregunta')).toBeEnabled({ timeout: 50000 });
        await expect(f.getByRole('log')).toContainText(question);
        if (row.flow === 'functional-limit') {
            await expect(f.getByRole('log')).toContainText(/orientación|orientacion/i);
            await expect(f.getByRole('log')).toContainText(/canales oficiales|PQRS|solicitud/i);
        }
        if (row.flow === 'rating') {
            if (authorized) {
                await f.getByRole('button', { name: 'Útil', exact: true }).last().click();
                await expect(f.getByText('Gracias por su valoración').last()).toBeVisible();
            }
            else
                await expect(f.getByRole('button', { name: 'Útil', exact: true })).toHaveCount(0);
        }
        if (row.flow === 'new-conversation') {
            await f.getByRole('button', { name: 'Nueva conversación' }).click();
            await expect(f.getByRole('dialog')).toBeVisible();
            if (variant === 'cancelled') {
                await f.getByRole('button', { name: 'Cancelar', exact: true }).click();
                await expect(f.getByRole('log')).toContainText(question);
            }
            else {
                await f.getByRole('button', { name: 'Iniciar nueva', exact: true }).click();
                await expect(f.getByRole('log')).not.toContainText(question);
                await expect(f.getByRole('button', { name: 'No autorizo', exact: true })).toBeVisible();
            }
        }
        checks.push(row.flow + '-' + variant);
    }
    return checks;
}
