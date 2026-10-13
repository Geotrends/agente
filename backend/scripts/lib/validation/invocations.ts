import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { ConverseSender } from '../../../src/bedrock/client.js';
import { askBedrock, ModelError } from '../../../src/bedrock/askBedrock.js';
import type { ModelAdapter } from '../../../src/chat/contracts.js';
export type Attempt = {
    attemptIndex: number;
    requestedModel: string;
    sentModel: string;
    effectiveModel: string | null;
    status: 'success' | 'failure';
    at: string;
    requestId?: string;
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
    errorCode?: string;
};
/** Observer scoped to one case; records only actual sender boundary, never request/response bodies. */
export function observeBedrock(sender: ConverseSender, sink: Attempt[], privacy?: {
    promptLeak: boolean;
}): ModelAdapter {
    return { call: async (requestedModel, req) => {
            let attempt: Attempt | undefined;
            const observed: ConverseSender = { send: async (command, options) => {
                    if (!(command instanceof ConverseCommand) || !command.input.modelId)
                        throw new ModelError('config', false, 'command_invalido');
                    attempt = { attemptIndex: sink.length + 1, requestedModel, sentModel: command.input.modelId, effectiveModel: null, status: 'failure', at: new Date().toISOString() };
                    sink.push(attempt);
                    const raw = await sender.send(command, options);
                    const safe = raw as {
                        usage?: {
                            inputTokens?: unknown;
                            outputTokens?: unknown;
                        };
                        $metadata?: {
                            requestId?: unknown;
                        };
                    };
                    const requestId = safe?.$metadata?.requestId;
                    if (typeof requestId === 'string' && /^[a-zA-Z0-9._:-]{1,200}$/.test(requestId))
                        attempt.requestId = requestId;
                    const u = safe?.usage;
                    if (u && Number.isSafeInteger(u.inputTokens) && Number.isSafeInteger(u.outputTokens) && Number(u.inputTokens) >= 0 && Number(u.outputTokens) >= 0)
                        attempt.usage = { inputTokens: Number(u.inputTokens), outputTokens: Number(u.outputTokens) };
                    return raw;
                } };
            try {
                const result = await askBedrock(requestedModel, req, observed);
                if (req.signal?.aborted)
                    throw new ModelError('timeout', false, 'abort');
                if (privacy)
                    privacy.promptLeak = req.system.length >= 128 && result.text.includes(req.system.slice(0, 128));
                if (attempt) {
                    attempt.status = 'success';
                    attempt.effectiveModel = result.effectiveModel;
                }
                return result;
            }
            catch (error) {
                if (attempt)
                    attempt.errorCode = error instanceof ModelError ? error.kind : 'network';
                throw error;
            }
        } };
}
