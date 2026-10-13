/** Puerto privado de aceptación. Nunca se cablea desde un payload HTTP. */
import type { ModelAdapter, ModelCallResult, ModelRequest } from '../../../src/chat/contracts.js';
import { abortable } from '../../../src/chat/modelRouting.js';
import type { Deadline } from '../../../src/chat/deadline.js';
import { ModelError } from '../../../src/bedrock/askBedrock.js';
import { ALLOWED_BEDROCK_MODELS } from '../../../src/services/diConfig.js';
export function independentPolicy(adapter: ModelAdapter, target: string, enabled: readonly string[]): (req: Omit<ModelRequest, 'deadline' | 'signal'>, deadline: Deadline) => Promise<ModelCallResult> {
    if (!enabled.includes(target) || !(ALLOWED_BEDROCK_MODELS as readonly string[]).includes(target))
        throw new ModelError('config', false, 'modelo_no_permitido');
    return async (req, deadline) => {
        deadline.throwIfExpired();
        const budget = deadline.modelBudgetMs();
        if (budget <= 0 || deadline.signal.aborted)
            throw new ModelError('timeout', false, 'abort');
        const signal = AbortSignal.any([AbortSignal.timeout(budget), deadline.signal]);
        const result = await abortable(adapter.call(target, { ...req, deadline: deadline.expiresAt, signal }), signal);
        if (result.effectiveModel !== target)
            throw new ModelError('config', false, 'modelo_efectivo_distinto');
        return result;
    };
}
