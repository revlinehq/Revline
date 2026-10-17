"use node";

import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { OPENAI_EDIT_MODELS } from '../lib/ai/claude-model';

async function readOpenAIMetadata(path: string): Promise<{ status: number; errorCode: string | null; body?: unknown }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { status: 0, errorCode: 'openai_not_configured' };
  let url: URL;
  try {
    const baseURL = process.env.OPENAI_BASE_URL?.trim().replace(/\/+$/, '') || 'https://api.openai.com/v1';
    url = new URL(`${baseURL}/${path}`);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
  } catch { return { status: 0, errorCode: 'invalid_base_url' }; }
  try {
    const response = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    const body: unknown = await response.json().catch(() => null);
    const raw = body && typeof body === 'object' && 'error' in body ? body.error : null;
    const code = raw && typeof raw === 'object' && 'code' in raw ? raw.code : null;
    const errorCode = typeof code === 'string' && code !== apiKey && /^[a-zA-Z0-9_-]{1,80}$/.test(code) ? code : null;
    return { status: response.status, errorCode, body };
  } catch { return { status: 0, errorCode: 'model_probe_failed' }; }
}

/** Admin-only metadata check. Keys, request headers and provider messages stay private. */
export const openAIModelAccess = internalAction({
  args: { modelId: v.union(...OPENAI_EDIT_MODELS.map(model => v.literal(model.modelId))) },
  returns: v.object({ modelId: v.string(), status: v.number(), errorCode: v.union(v.string(), v.null()) }),
  handler: async (_ctx, { modelId }) => {
    const { status, errorCode, body } = await readOpenAIMetadata(`models/${encodeURIComponent(modelId)}`);
    const valid = !!body && typeof body === 'object' && 'id' in body && body.id === modelId;
    return { modelId, status, errorCode: status >= 200 && status < 300 ? valid ? null : 'unexpected_model_response' : errorCode };
  },
});

/** Admin-only list of IDs; no account metadata or raw provider response leaves Convex. */
export const openAIAvailableModels = internalAction({
  args: {},
  returns: v.object({ modelIds: v.array(v.string()), status: v.number(), errorCode: v.union(v.string(), v.null()) }),
  handler: async () => {
    const { status, errorCode, body } = await readOpenAIMetadata('models');
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
