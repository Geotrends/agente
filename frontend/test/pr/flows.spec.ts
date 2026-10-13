import { test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { runFlow } from './steps';
import { writeImmutable } from '../../../backend/scripts/lib/validation/artifacts';
import type { MatrixC4 } from '../../../backend/scripts/lib/validation/matrixC4';
import type { MatrixC3 } from '../../../backend/scripts/lib/validation/matrixC3';
type Job = {
    adapter: 'aws' | 'controlled';
    executionCaseIds: string[];
    root: string;
    runId: string;
    matrix: MatrixC4;
    c3: MatrixC3;
    target: {
        hostUrl: string;
        chatUrl: string;
    };
    environments: Record<string, {
        ref: {
            path: string;
            sha256: string;
            mediaType: string;
        };
        viewport: {
            width: number;
            height: number;
        };
        browserVersion: string;
        deviceKind: string;
    }>;
};
if (process.env.PR_JOB) {
    const job: Job = JSON.parse(readFileSync(process.env.PR_JOB, 'utf8'));
    for (const row of job.matrix.cases.filter(c => job.executionCaseIds.includes(c.id)))
        test(row.id, async ({ page, browser }) => { const e = job.environments[row.environment]; await page.setViewportSize(e.viewport); const startedAt = new Date().toISOString(); let checks: string[] = []; let failed = false; try {
            if (e.deviceKind === 'physical' && browser.version() !== e.browserVersion)
                throw new Error('browser_identity');
            checks = await runFlow(page, row, job.c3, job.target);
        }
        catch {
            failed = true;
        } const screenshot = await page.screenshot(); const evidenceRef = await writeImmutable(job.root, `runs/${job.runId}/screenshots/${row.id}.json`, { schemaVersion: 1, mediaType: 'image/png', base64: screenshot.toString('base64') }); const observedRef = await writeImmutable(job.root, `runs/${job.runId}/observed/${row.id}.json`, { schemaVersion: 1, caseId: row.id, adapter: job.adapter, response: { checks, variants: row.variants ?? [], failed }, attempts: [], promptLeak: false, exposedPointIds: [] }); await writeImmutable(job.root, `runs/${job.runId}/results/${row.id}.json`, { caseId: row.id, environment: row.environment, executionEnvironmentRef: e.ref, startedAt, finishedAt: new Date().toISOString(), observedRef, evidenceRefs: [observedRef, evidenceRef], checks: [{ id: 'flow-variants', status: failed ? 'fail' : 'pass', reason: failed ? 'El flujo o una variante falló' : 'Todas las variantes del flujo verificadas' }], automaticVerdict: failed ? 'fail' : 'pass', manualChecksRequired: ['expected-semantic', 'device', 'reader'], attempts: [] }); if (failed)
            throw new Error('flow_failed'); });
}
