import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createFalClient } from '@fal-ai/client';
import { AnalysisError } from '@/lib/media-analysis/errors';

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024 * 1024;
export type FalClient = ReturnType<typeof createFalClient>;

/** The fal client for the media worker's FAL_KEY, or undefined when none is set. */
export function configuredFal(): FalClient | undefined {
  const key = process.env.FAL_KEY;
  return key ? createFalClient({ credentials: key }) : undefined;
}

/** The fal client, or a 503 with the caller's message when FAL_KEY is missing. */
export function requireFal(missing: string): FalClient {
  const fal = configuredFal();
  if (!fal) throw new AnalysisError(missing, 503);
  return fal;
}

export async function subscribe(fal: FalClient, endpoint: string, input: Record<string, unknown>, signal: AbortSignal) {
  let requestId: string | undefined;
  try {
    const result = await fal.subscribe(endpoint, { input, pollInterval: 3000, abortSignal: signal, onEnqueue: id => { requestId = id; } });
    return result.data;
  } catch (error) {
    // Stop the paid job too when the task is cancelled.
    if (signal.aborted && requestId) await fal.queue.cancel(endpoint, { requestId }).catch(() => {});
    throw signal.aborted ? error : new AnalysisError(`AI video processing failed: ${error instanceof Error ? error.message.slice(0, 300) : 'unknown error'}`, 502);
  }
}

export async function download(url: string, path: string, signal: AbortSignal, maxBytes = MAX_OUTPUT_BYTES) {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) throw new AnalysisError(`Could not download the processed media (HTTP ${response.status}).`, 502);
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) throw new AnalysisError('The processed media is too large to store.', 400);
  let bytes = 0;
  const bounded = new Transform({ transform(chunk: Buffer, _encoding, done) { bytes += chunk.length; done(bytes > maxBytes ? new AnalysisError('The processed media is too large to store.', 400) : null, chunk); } });
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), bounded, createWriteStream(path), { signal });
}
