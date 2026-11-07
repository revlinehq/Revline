import { readFile } from 'node:fs/promises';
import { decodeMaskToRaster, parseImageStream, parseVideoStream, recordsOfKind, buildObjectPrompt, type SegmentationMaskRecord, type SegmentationResult } from '@meta-sam/parser';
import { z } from 'zod';
import { AnalysisError } from '../media-analysis/errors';

/** Segment Anything 3.1, called directly on Meta's Model API (https://dev.meta.ai/docs/sam/overview).
 * The model id is pinned: a response from any other model is rejected, never used. */
export const META_SAM_MODEL = 'sam-3.1';
export const META_SAM_LABEL = 'SAM 3.1 (Meta)';
const API = 'https://api.meta.ai/v1';
const MODEL_PATTERN = /^sam-3\.1(?:$|[-@:])/;

/** The worker-only Meta Model API key, or undefined when none is set. */
export const configuredMetaSam = () => process.env.MODEL_API_KEY || undefined;

/** The key, or a clear 503. SAM 3.1 requests never fall back to an older SAM. */
export function requireMetaSam() {
  const key = configuredMetaSam();
  if (!key) throw new AnalysisError('SAM 3.1 needs MODEL_API_KEY on the media worker. It does not fall back to SAM2.', 503, false);
  return key;
}

/** Pixel coordinates in the media as sent; right/bottom are half-open. */
export type SamBox = { left: number; top: number; right: number; bottom: number };
export type SamPrompt =
  | { kind: 'noun'; noun: string }
  | { kind: 'object'; frame?: number; box?: SamBox; point?: { x: number; y: number } };
export type SamSize = { width: number; height: number };

const errorBody = z.object({ error: z.object({ message: z.string().optional(), code: z.string().nullish() }) });

async function failure(response: Response): Promise<AnalysisError> {
  const text = await response.text().catch(() => '');
  let detail = '';
  try { const parsed = errorBody.safeParse(JSON.parse(text)); if (parsed.success) detail = parsed.data.error.message ?? parsed.data.error.code ?? ''; } catch { detail = text; }
  detail = detail.slice(0, 300);
  const status = response.status;
  if (status === 401 || status === 403) return new AnalysisError('Meta Model API rejected MODEL_API_KEY for SAM 3.1.', 503, false);
  if (status === 404) return new AnalysisError(`Meta Model API did not find ${META_SAM_MODEL}${detail ? `: ${detail}` : ''}. No older SAM is used instead.`, 502, false);
  if (status === 400 || status === 413 || status === 422) return new AnalysisError(`SAM 3.1 refused the request${detail ? `: ${detail}` : ''}.`, 422, false);
  return new AnalysisError(`SAM 3.1 is unavailable (HTTP ${status})${detail ? `: ${detail}` : ''}.`, status === 429 ? 503 : 502, true);
}

/** Server-sent events from /v1/responses, with the reported model checked against sam-3.1. */
async function* events(response: Response): AsyncGenerator<{ type: string }> {
  if (!response.body) throw new AnalysisError('SAM 3.1 returned no stream.', 502, true);
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = function* (block: string) {
    const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (!data || data === '[DONE]') return;
    const event = JSON.parse(data) as { type: string; response?: { model?: unknown } };
    const model = event.response?.model;
    if (typeof model === 'string' && !MODEL_PATTERN.test(model)) throw new AnalysisError(`Meta answered with ${model.slice(0, 60)} instead of ${META_SAM_MODEL}; the result was discarded.`, 502, false);
    yield event;
  };
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let end: RegExpExecArray | null;
    while ((end = /\r?\n\r?\n/.exec(buffer))) {
      const block = buffer.slice(0, end.index);
      buffer = buffer.slice(end.index + end[0].length);
      yield* parse(block);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield* parse(buffer);
}

function promptText(prompt: SamPrompt, size: SamSize) {
  if (prompt.kind === 'noun') return prompt.noun;
  const clamp = (value: number, max: number) => Math.max(0, Math.min(max, Math.round(value)));
  const box = prompt.box && {
    left: clamp(prompt.box.left, size.width - 1), top: clamp(prompt.box.top, size.height - 1),
    right: clamp(prompt.box.right, size.width), bottom: clamp(prompt.box.bottom, size.height),
  };
  if (box && (box.right <= box.left || box.bottom <= box.top)) throw new AnalysisError('The subject box is empty at this frame size.', 422, false);
  const point = prompt.point && { x: clamp(prompt.point.x, size.width - 1), y: clamp(prompt.point.y, size.height - 1) };
  return buildObjectPrompt({ size, objects: [{ id: 1, prompts: [{ frame: prompt.frame ?? 0, ...(box ? { box } : {}), ...(point ? { points: [point] } : {}) }] }] });
}

async function respond<Result extends SegmentationResult>(key: string, media: Record<string, unknown>, text: string, metadata: Record<string, string>, parse: (source: AsyncIterable<{ type: string }>) => AsyncIterable<unknown> & { finalResult: Promise<Result> }, signal: AbortSignal) {
  const response = await fetch(`${API}/responses`, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ model: META_SAM_MODEL, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text }, media] }], stream: true, store: false, metadata: { include_confidence: 'true', ...metadata } }),
  });
  if (!response.ok) throw await failure(response);
  try {
    const parsed = parse(events(response));
    for await (const _ of parsed) { /* snapshots are not needed; the final result holds every record */ }
    const result = await parsed.finalResult;
    if (result.outcome.status !== 'completed') throw new AnalysisError(`SAM 3.1 ended early${result.outcome.detail ? `: ${result.outcome.detail}` : ''}.`, 502, true);
    const broken = result.diagnostics.find(item => item.severity === 'error');
    if (broken) throw new AnalysisError(`SAM 3.1 returned an unreadable record (${broken.code}).`, 502, true);
    return result;
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof AnalysisError) throw error;
    throw new AnalysisError(`SAM 3.1 failed: ${error instanceof Error ? error.message.slice(0, 300) : 'unknown error'}`, 502, true);
  }
}

/** Segment one image. A noun returns every match; an object prompt returns object 1. */
export async function segmentImage(key: string, image: { data: Buffer; mime: string }, prompt: SamPrompt, size: SamSize, signal: AbortSignal) {
  const result = await respond(key, { type: 'input_image', image_url: `data:${image.mime};base64,${image.data.toString('base64')}` }, promptText(prompt, size), {}, parseImageStream, signal);
  return recordsOfKind(result.records, 'mask');
}

/** Track object 1 through a video from an object prompt on one frame, both directions.
 * The clip goes through the Files API with a one-hour expiry and is deleted afterwards. */
export async function segmentVideo(key: string, path: string, prompt: Extract<SamPrompt, { kind: 'object' }>, size: SamSize, signal: AbortSignal) {
  const form = new FormData();
  form.append('purpose', 'user_data');
  form.append('expires_after[anchor]', 'created_at');
  form.append('expires_after[seconds]', '3600');
  form.append('file', new Blob([await readFile(path)], { type: 'video/mp4' }), 'clip.mp4');
  const upload = await fetch(`${API}/files`, { method: 'POST', signal, headers: { Authorization: `Bearer ${key}` }, body: form });
  if (!upload.ok) throw await failure(upload);
  const { id } = z.object({ id: z.string().min(1) }).parse(await upload.json());
  try {
    const result = await respond(key, { type: 'input_video', file_id: id }, promptText(prompt, size), { propagation_direction: 'both' }, parseVideoStream, signal);
    return recordsOfKind(result.records, 'mask').filter(record => record.objectId === '1');
  } finally {
    await fetch(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) }).then(response => response.body?.cancel()).catch(() => {});
  }
}

/** Paint mask records into a full-frame 8-bit alpha (0 or 255). Each raster covers its record's box. */
export function paintMasks(records: readonly SegmentationMaskRecord[], size: SamSize, target = new Uint8Array(size.width * size.height)) {
  for (const record of records) {
    const raster = decodeMaskToRaster(record.mask), { width: rw, height: rh } = record.mask;
    const left = record.bounds.left, top = record.bounds.top;
    const bw = Math.max(1, record.bounds.right - left), bh = Math.max(1, record.bounds.bottom - top);
    for (let y = 0; y < bh; y++) {
      const fy = top + y;
      if (fy < 0 || fy >= size.height) continue;
      const row = Math.min(rh - 1, Math.floor(y * rh / bh)) * rw;
      for (let x = 0; x < bw; x++) {
        const fx = left + x;
        if (fx >= 0 && fx < size.width && raster[row + Math.min(rw - 1, Math.floor(x * rw / bw))]) target[fy * size.width + fx] = 255;
      }
    }
  }
  return target;
}
