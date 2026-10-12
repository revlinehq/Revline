import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import { AnalysisError } from './errors';
import { interactionText, parseTranscript } from './transcript';
import { parseUnderstanding, understandingJsonSchema, understandingPrompt, type Understanding } from './understanding';

const BASE = 'https://generativelanguage.googleapis.com';
const fileSchema = z.object({ name: z.string(), uri: z.string(), state: z.string().optional() });

async function googleResponse(response: Response) {
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new AnalysisError('Gemini rejected the API key. Verify the configured Gemini credentials and model access.', 502);
    if (response.status === 429) throw new AnalysisError('Gemini is rate limited or its quota is exhausted. Please try again later.', 429);
    throw new AnalysisError(`Gemini could not process this media (HTTP ${response.status}).`, 502);
  }
  return response;
}

function headers(key: string) { return { 'x-goog-api-key': key }; }

async function uploadFile(path: string, mimeType: string, key: string, signal: AbortSignal) {
  const { size } = await stat(path);
  const initialization = await googleResponse(await fetch(`${BASE}/upload/v1beta/files`, {
    method: 'POST', signal, headers: { ...headers(key), 'Content-Type': 'application/json', 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(size), 'X-Goog-Upload-Header-Content-Type': mimeType },
    body: JSON.stringify({ file: { display_name: 'Revline source analysis' } }),
  }));
  const uploadUrl = initialization.headers.get('x-goog-upload-url');
  if (!uploadUrl || new URL(uploadUrl).protocol !== 'https:' || !new URL(uploadUrl).hostname.endsWith('.googleapis.com')) throw new AnalysisError('Gemini did not return a valid upload endpoint.', 502);
  const uploadOptions = { method: 'POST', signal, headers: { ...headers(key), 'Content-Length': String(size), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' }, body: createReadStream(path) as unknown as BodyInit, duplex: 'half' } satisfies RequestInit & { duplex: 'half' };
  const uploaded = await googleResponse(await fetch(uploadUrl, uploadOptions));
  const response = await uploaded.json() as { file: unknown };
  const initialFile = fileSchema.parse(response.file);
  let file = initialFile;
  try {
    for (let attempt = 0; file.state === 'PROCESSING' && attempt < 60; attempt++) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 1000);
        function cancel() { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(new Error('Analysis cancelled.')); }
        if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
      });
      const metadata = await googleResponse(await fetch(`${BASE}/v1beta/${file.name}`, { headers: headers(key), signal }));
      file = fileSchema.parse(await metadata.json());
    }
    if (file.state === 'FAILED' || file.state === 'PROCESSING') throw new AnalysisError('Gemini could not prepare the uploaded media for analysis.', 502);
    return file;
  } catch (error) {
    await deleteFile(initialFile.name, key);
    throw error;
  }
}

async function deleteFile(name: string, key: string) {
  await fetch(`${BASE}/v1beta/${name}`, { method: 'DELETE', headers: headers(key), signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
}

async function interaction(body: Record<string, unknown>, key: string, signal: AbortSignal) {
  const response = await googleResponse(await fetch(`${BASE}/v1beta/interactions`, { method: 'POST', signal, headers: { ...headers(key), 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, store: false }) }));
  const result = await response.json() as { status?: string; error?: unknown };
  if (result.error || result.status === 'failed') throw new AnalysisError('Gemini could not complete the media analysis.', 502);
  return result;
}

/** REST contract verified against https://ai.google.dev/gemini-api/docs/transcribe. */
export async function transcribeAudio(path: string, duration: number, key: string, signal: AbortSignal) {
  const file = await uploadFile(path, 'audio/wav', key, signal);
  try {
    const result = await interaction({ model: process.env.GEMINI_TRANSCRIPTION_MODEL || 'gemini-3.5-transcribe', input: [{ type: 'audio', uri: file.uri, mime_type: 'audio/wav' }], generation_config: { transcription_config: { mode: { type: 'verbatim', timestamp_granularities: ['word'] } } } }, key, signal);
    try { return parseTranscript(result, duration); }
    catch (error) { throw new AnalysisError(error instanceof Error ? error.message : 'Gemini returned an unreadable transcription.', 502); }
  } finally { await deleteFile(file.name, key); }
}

/** Source timestamps describe observed scenes; structured output never becomes executable HTML. */
export async function understandVideo(path: string, duration: number, key: string, signal: AbortSignal): Promise<Understanding> {
  const file = await uploadFile(path, 'video/mp4', key, signal);
  try {
    const result = await interaction({
      model: process.env.GEMINI_VIDEO_MODEL || 'gemini-3.8-flash',
      input: [
        { type: 'video', uri: file.uri, mime_type: 'video/mp4', processing: { type: 'static', fps: 1 } },
        { type: 'text', text: understandingPrompt(duration) },
      ],
      response_format: { type: 'text', mime_type: 'application/json', schema: understandingJsonSchema },
    }, key, signal);
    return parseUnderstanding(interactionText(result), duration, 'Gemini');
  } finally { await deleteFile(file.name, key); }
}
