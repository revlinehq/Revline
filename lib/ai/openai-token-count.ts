import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { AssistantTokenBudgetError, EDITOR_RAW_INPUT_LIMIT } from './token-budget';
import { assistantFailureReason } from './assistant-error';

const BASE = 'https://api.openai.com/v1';
const countFields = ['model', 'input', 'instructions', 'tools', 'tool_choice', 'text', 'reasoning', 'truncation', 'parallel_tool_calls', 'personality', 'previous_response_id', 'conversation'] as const;
type Measurement = { method: 'openai-input-tokens'; countedTokens: number; reservedTokens: number };

/** Capture the installed SDK's exact token-bearing wire format locally. */
async function encodeOpenAICount(params: LanguageModelV4CallOptions, modelId: string): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> | undefined;
  const serializer = createOpenAI({ apiKey: 'local-serialization-only', baseURL: BASE, fetch: async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ id: 'serialization-only', output: [] });
  } }).responses(modelId);
  await serializer.doGenerate(params);
  if (!body) throw new AssistantTokenBudgetError('usage');
  return Object.fromEntries(countFields.filter(field => body![field] !== undefined).map(field => [field, body![field]]));
}

function countFailure(statusCode?: number, detail?: unknown) {
  const failure = new AssistantTokenBudgetError('usage');
  failure.message = assistantFailureReason({ statusCode, message: detail }, 'openai') ?? 'OpenAI input token counting is unavailable. No generation was started; retry when token counting is available.';
  return Object.assign(failure, statusCode === undefined ? {} : { statusCode });
}

/** Count without generation. Keep the existing 10% + 4096 reserve margin and
 * all cumulative guards. https://developers.openai.com/api/docs/guides/token-counting */
export function openAITokenCounter(modelId: string, key: string, onCount?: (measurement: Measurement) => void) {
  return async (params: LanguageModelV4CallOptions) => {
    if (process.env.OPENAI_BASE_URL && process.env.OPENAI_BASE_URL.replace(/\/+$/, '') !== BASE) throw countFailure();
    const body = await encodeOpenAICount(params, modelId);
    let response: Response;
    try {
      response = await fetch(`${BASE}/responses/input_tokens`, {
        method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(params.abortSignal ? [params.abortSignal] : [])]),
      });
    } catch { throw countFailure(); }
    const result: unknown = await response.json().catch(() => null);
    const record = result !== null && typeof result === 'object' ? result as { object?:unknown; input_tokens?: unknown; error?: { message?: unknown } } : null;
    if (!response.ok) throw countFailure(response.status, record?.error?.message);
    const tokens = record?.input_tokens;
    if (record?.object !== 'response.input_tokens' || typeof tokens !== 'number' || !Number.isSafeInteger(tokens) || tokens < 0 || tokens > EDITOR_RAW_INPUT_LIMIT) throw countFailure();
    const reservedTokens = Math.ceil(tokens * 11 / 10) + 4096;
    onCount?.({ method: 'openai-input-tokens', countedTokens: tokens, reservedTokens });
    return reservedTokens;
  };
}
