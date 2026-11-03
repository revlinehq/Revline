import { createWriteStream } from 'node:fs';
import { open, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AnalysisError } from '../media-analysis/errors';
import { retryMediaOperation } from '../media-analysis/network';

type DownloadOptions = { concurrency?: 1 | 2 | 3; onProgress?: (downloaded: number, total: number) => void };

export function ownedMediaUrl(url: string, origin: string) {
  const parsed = new URL(url);
  const mediaOrigin = process.env.MEDIA_WORKER_URL ? new URL(process.env.MEDIA_WORKER_URL).origin : null;
  const fromR2 = parsed.origin === mediaOrigin && parsed.pathname === '/read';
  const fromLegacyStorage = parsed.origin === new URL(origin).origin && parsed.pathname.startsWith('/api/storage/');
  if (parsed.username || parsed.password || (!fromR2 && !fromLegacyStorage)) {
    throw new Error('Render media must come from this project’s configured storage.');
  }
  return parsed.toString();
}

export async function downloadOwnedMedia(url: string, path: string, origin: string, expectedSize: number, signal: AbortSignal, options: DownloadOptions = {}) {
  const parsed = new URL(ownedMediaUrl(url, origin));
  const fromR2 = parsed.pathname === '/read';
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1) throw new Error('The source file has invalid size metadata. Re-upload it.');
  const disk = await statfs(tmpdir());
  // Keep room for the export and other concurrent jobs; capacity follows the host disk.
  if (expectedSize > disk.bavail * disk.bsize / 3) throw new Error('The render server needs more temporary disk space for this source.');
  const concurrency = fromR2 && expectedSize >= 64 * 1024 * 1024 ? options.concurrency ?? 1 : 1;
  await retryMediaOperation(async () => {
    const attemptSignal = AbortSignal.any([signal, AbortSignal.timeout(15 * 60_000)]);
    if (concurrency > 1) return downloadRanges(parsed, path, expectedSize, concurrency, attemptSignal, options.onProgress);
    const response = await fetch(parsed, { signal: attemptSignal, redirect: 'error' });
    await writeResponse(response, path, expectedSize, attemptSignal, bytes => options.onProgress?.(bytes, expectedSize));
  }, signal);
}

async function writeResponse(response: Response, path: string, expectedSize: number, signal: AbortSignal, onProgress: (bytes: number) => void, start?: number) {
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new AnalysisError(`Could not download source media (HTTP ${response.status}).`, response.status);
  }
  let bytes = 0;
  const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > expectedSize) { callback(new Error('The source file does not match its uploaded size.')); return; }
    onProgress(bytes);
    callback(null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), limit, createWriteStream(path, start === undefined ? undefined : { flags: 'r+', start }), { signal });
  if (bytes !== expectedSize) throw new Error('The source download was incomplete. Please retry.');
}

async function downloadRanges(url: URL, path: string, size: number, concurrency: number, signal: AbortSignal, onProgress?: DownloadOptions['onProgress']) {
  const controller = new AbortController(), combined = AbortSignal.any([signal, controller.signal]);
  const partSize = Math.ceil(size / concurrency);
  const ranges = Array.from({ length: concurrency }, (_, index) => ({ start: index * partSize, end: Math.min(size, (index + 1) * partSize) - 1 }));
  const firstRange = ranges[0];
  // Check support before starting siblings: a server ignoring Range sends one
  // full response, which can be consumed directly without duplicate downloads.
  const first = await fetch(url, { headers: { Range: `bytes=${firstRange.start}-${firstRange.end}` }, signal: combined, redirect: 'error' });
  if (!first.ok) { await first.body?.cancel().catch(() => {}); throw new AnalysisError(`Could not download source media (HTTP ${first.status}).`, first.status); }
  if (first.status === 200) {
    await writeResponse(first, path, size, combined, bytes => onProgress?.(bytes, size));
    return;
  }
  let downloaded = 0, failure: unknown;
  const etag = first.headers.get('ETag');
  const validate = (response: Response, range: typeof firstRange) => {
    if (!response.ok) throw new AnalysisError(`Could not download source media (HTTP ${response.status}).`, response.status);
    if (response.status !== 206 || response.headers.get('Content-Range') !== `bytes ${range.start}-${range.end}/${size}` || !response.body || !etag || response.headers.get('ETag') !== etag) {
      throw new Error('The source download returned an invalid byte range. Please retry.');
    }
  };
  try {
    validate(first, firstRange);
    const file = await open(path, 'w');
    try { await file.truncate(size); } finally { await file.close(); }
    const results = await Promise.allSettled(ranges.map(async (range, index) => {
      let response: Response | undefined;
      try {
        response = index === 0 ? first : await fetch(url, { headers: { Range: `bytes=${range.start}-${range.end}`, 'If-Match': etag! }, signal: combined, redirect: 'error' });
        validate(response, range);
        let previous = 0;
        await writeResponse(response, path, range.end - range.start + 1, combined, bytes => {
          downloaded += bytes - previous; previous = bytes;
          onProgress?.(downloaded, size);
        }, range.start);
      } catch (error) {
        if (!controller.signal.aborted) { failure = error; controller.abort(error); }
        throw error;
      } finally {
        if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
      }
    }));
    const rejected = results.find(result => result.status === 'rejected');
    if (rejected?.status === 'rejected') throw failure ?? rejected.reason;
  } finally {
    if (first.body && !first.body.locked) await first.body.cancel().catch(() => {});
  }
}
