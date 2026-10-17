"use node";

import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { OPENAI_EDIT_MODELS } from '../lib/ai/claude-model';

async function requestOpenAIDiagnostic(path: string, payload?: Record<string, unknown>): Promise<{ status: number; errorCode: string | null; body?: unknown }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { status: 0, errorCode: 'openai_not_configured' };
  let url: URL;
  try {
    const baseURL = process.env.OPENAI_BASE_URL?.trim().replace(/\/+$/, '') || 'https://api.openai.com/v1';
    url = new URL(`${baseURL}/${path}`);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
  } catch { return { status: 0, errorCode: 'invalid_base_url' }; }
  try {
    const response = await fetch(url, { method: payload ? 'POST' : 'GET', headers: { Authorization: `Bearer ${apiKey}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}), redirect: 'error', signal: AbortSignal.timeout(payload ? 20_000 : 15_000) });
    const body: unknown = await response.json().catch(() => null);
    const raw = body && typeof body === 'object' && 'error' in body ? body.error : null;
    const code = raw && typeof raw === 'object' && 'code' in raw ? raw.code : null;
    const errorCode = typeof code === 'string' && code !== apiKey && /^[a-zA-Z0-9_-]{1,80}$/.test(code) ? code : null;
    return { status: response.status, errorCode, body };
  } catch (error) { return { status: 0, errorCode: error instanceof Error && /^(?:TimeoutError|AbortError)$/.test(error.name) ? 'model_probe_timeout' : 'model_probe_failed' }; }
}

/** Admin-only metadata check. Keys, request headers and provider messages stay private. */
export const openAIModelAccess = internalAction({
  args: { modelId: v.union(...OPENAI_EDIT_MODELS.map(model => v.literal(model.modelId))) },
  returns: v.object({ modelId: v.string(), status: v.number(), errorCode: v.union(v.string(), v.null()) }),
  handler: async (_ctx, { modelId }) => {
    const { status, errorCode, body } = await requestOpenAIDiagnostic(`models/${encodeURIComponent(modelId)}`);
    const valid = !!body && typeof body === 'object' && 'id' in body && body.id === modelId;
    return { modelId, status, errorCode: status >= 200 && status < 300 ? valid ? null : 'unexpected_model_response' : errorCode };
  },
});

/** Admin-only list of IDs; no account metadata or raw provider response leaves Convex. */
export const openAIAvailableModels = internalAction({
  args: {},
  returns: v.object({ modelIds: v.array(v.string()), status: v.number(), errorCode: v.union(v.string(), v.null()) }),
  handler: async () => {
    const { status, errorCode, body } = await requestOpenAIDiagnostic('models');
    if (status < 200 || status >= 300) return { modelIds: [], status, errorCode };
    const data = body && typeof body === 'object' && 'data' in body ? body.data : null;
    if (!Array.isArray(data)) return { modelIds: [], status, errorCode: 'unexpected_model_response' };
    const modelIds = data.slice(0, 1000).flatMap(model => {
      const id = model && typeof model === 'object' && 'id' in model ? model.id : null;
      return typeof id === 'string' && id !== process.env.OPENAI_API_KEY?.trim() && /^[a-zA-Z0-9._:-]{1,120}$/.test(id) ? [id] : [];
    });
    return { modelIds: [...new Set(modelIds)].sort(), status, errorCode: null };
  },
});

const nullableCount = v.union(v.number(), v.null());
const numericUsage = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Admin-only paid generation check: one tiny synthetic request, no tools or retries. */
export const openAIGenerationAccess = internalAction({
  args: { modelId: v.union(...OPENAI_EDIT_MODELS.map(model => v.literal(model.modelId))) },
  returns: v.object({ modelId: v.string(), model: v.union(v.string(), v.null()), status: v.number(), available: v.boolean(), errorCode: v.union(v.string(), v.null()), usage: v.object({ inputTokens: nullableCount, outputTokens: nullableCount, reasoningTokens: nullableCount, cachedInputTokens: nullableCount, cacheWriteInputTokens: nullableCount }) }),
  handler: async (_ctx, { modelId }) => {
    const { status, errorCode, body } = await requestOpenAIDiagnostic('responses', {
      model: modelId, input: 'Reply OK.', max_output_tokens: 16,
      reasoning: { effort: 'medium', mode: 'standard' }, service_tier: 'default', store: false,
      include: ['reasoning.encrypted_content'], prompt_cache_options: { ttl: '30m' },
    });
    const response = object(body), rawUsage = object(response.usage);
    const model = typeof response.model === 'string' && (response.model === modelId || new RegExp(`^${modelId.replaceAll('.', '\\.')}-\\d{4}-\\d{2}-\\d{2}$`).test(response.model)) ? response.model : null;
    const success = status >= 200 && status < 300;
    return { modelId, model, status, available: success && model !== null, errorCode: success ? model ? null : 'unexpected_model_response' : errorCode,
      usage: { inputTokens: numericUsage(rawUsage.input_tokens), outputTokens: numericUsage(rawUsage.output_tokens), reasoningTokens: numericUsage(object(rawUsage.output_tokens_details).reasoning_tokens), cachedInputTokens: numericUsage(object(rawUsage.input_tokens_details).cached_tokens), cacheWriteInputTokens: numericUsage(object(rawUsage.input_tokens_details).cache_write_tokens) },
    };
  },
});
