import { openAsBlob } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { AnalysisError } from './errors';
import { parseUnderstanding, understandingJsonSchema, understandingPrompt, type Understanding } from './understanding';

const BASE = 'https://api.twelvelabs.io/v1.3';
const assetSchema = z.object({ _id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), status: z.enum(['processing', 'ready', 'failed']) });
const headers = (key: string) => ({ 'x-api-key': key });

async function providerResponse(response: Response) {
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new AnalysisError('TwelveLabs rejected the API key or model access. Verify the server credentials.', 502);
    if (response.status === 429) throw new AnalysisError('TwelveLabs is rate limited or its quota is exhausted. Please try again later.', 429);
    throw new AnalysisError(`TwelveLabs could not process this video (HTTP ${response.status}).`, 502);
  }
  return response;
}

async function assetResponse(response: Response) {
  const parsed = assetSchema.safeParse(await (await providerResponse(response)).json());
  if (!parsed.success) throw new AnalysisError('TwelveLabs returned invalid media metadata.', 502);
  return parsed.data;
}

/** v1.3 REST contract: assets → ready → Pegasus structured analysis → delete temporary asset. */
export async function understandVideo(path: string, duration: number, key: string, signal: AbortSignal): Promise<Understanding> {
  if (duration < 1) throw new AnalysisError('TwelveLabs scene understanding requires a video at least one second long.', 400);
  signal.throwIfAborted();
  const form = new FormData();
  form.set('method', 'direct');
  form.set('file', await openAsBlob(path, { type: 'video/mp4' }), 'revline-analysis.mp4');
  form.set('enable_hls', 'false');
  form.set('enable_thumbnail', 'false');
  const uploaded = await assetResponse(await fetch(`${BASE}/assets`, { method: 'POST', headers: headers(key), body: form, signal }));
  try {
    let asset = uploaded;
    while (asset.status === 'processing') {
      await delay(2000, undefined, { signal });
      asset = await assetResponse(await fetch(`${BASE}/assets/${uploaded._id}`, { headers: headers(key), signal }));
    }
    if (asset.status !== 'ready') throw new AnalysisError('TwelveLabs could not prepare this video for scene analysis.', 502);
    const response = await providerResponse(await fetch(`${BASE}/analyze`, {
      method: 'POST', signal, headers: { ...headers(key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_name: process.env.TWELVELABS_VIDEO_MODEL || 'pegasus1.6', video: { type: 'asset_id', asset_id: uploaded._id }, prompt: understandingPrompt(duration), stream: false, temperature: 0.2, max_tokens: 8192, response_format: { type: 'json_schema', json_schema: understandingJsonSchema } }),
    }));
    const parsed = z.object({ data: z.string(), finish_reason: z.string(), error: z.unknown().optional() }).safeParse(await response.json());
    if (!parsed.success || parsed.data.error || parsed.data.finish_reason !== 'stop') throw new AnalysisError('TwelveLabs returned incomplete scene analysis. Please retry with a shorter clip.', 502);
    return parseUnderstanding(parsed.data.data, duration, 'TwelveLabs');
  } finally {
    // Cleanup must still run when the analysis signal has been canceled.
    await fetch(`${BASE}/assets/${uploaded._id}`, { method: 'DELETE', headers: headers(key), signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
  }
}
