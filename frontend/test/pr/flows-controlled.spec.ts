/** Synthetic API and existing SPEC004 host. These checks never certify acceptance. */
import { test, expect } from '@playwright/test';
import { runFlow } from './steps';
import { stubApi, HOST_ORIGIN, CHAT_ORIGIN } from '../helpers/api';
import { c3Fixture, c4Fixture } from '../../../backend/test/validation-support';
for (const row of c4Fixture().cases)
    test('controlled ' + row.id, async ({ page, context }) => { await page.setViewportSize(row.environment === 'mobile' ? { width: 390, height: 844 } : { width: 1366, height: 768 }); await stubApi(context, { answer: () => row.flow === 'c3-failure' ? { status: 503, delayMs: row.variants?.includes('waiting') ? 1200 : 0, json: { error: { codigo: 'SERVICIO_NO_DISPONIBLE' } } } : row.flow === 'functional-limit' ? { json: { modo: 'anónima', tipo: 'fuera de alcance', respuesta: 'Geobot solo brinda orientación. Para radicar o decidir use los canales oficiales.', fuentes: [] } } : {} }); const checks = await runFlow(page, row, c3Fixture(), { hostUrl: HOST_ORIGIN + '/observatorio', chatUrl: CHAT_ORIGIN + '/chat' }); expect(checks.length).toBeGreaterThan(0); });
