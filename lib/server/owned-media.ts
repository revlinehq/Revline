import { createWriteStream } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export async function downloadOwnedMedia(url: string, path: string, origin: string, expectedSize: number, signal: AbortSignal) {
  const parsed = new URL(url);
  const mediaOrigin = process.env.MEDIA_WORKER_URL ? new URL(process.env.MEDIA_WORKER_URL).origin : null;
  const fromR2 = parsed.origin === mediaOrigin && parsed.pathname === '/read';
  const fromLegacyStorage = parsed.origin === new URL(origin).origin && parsed.pathname.startsWith('/api/storage/');
  if (parsed.username || parsed.password || (!fromR2 && !fromLegacyStorage)) {
    throw new Error('Render media must come from this project’s configured storage.');
  }
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1) throw new Error('The source file has invalid size metadata. Re-upload it.');
  const disk = await statfs(tmpdir());
  // Keep room for the export and other concurrent jobs; capacity follows the host disk.
  if (expectedSize > disk.bavail * disk.bsize / 3) throw new Error('The render server needs more temporary disk space for this source.');
  const response = await fetch(parsed, { signal, redirect: 'error' });
  if (!response.ok || !response.body) throw new Error(`Could not download render media (HTTP ${response.status}).`);
  let bytes = 0;
  const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length;
    callback(bytes > expectedSize ? new Error('The source file does not match its uploaded size.') : null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), limit, createWriteStream(path), { signal });
  if (bytes !== expectedSize) throw new Error('The source download was incomplete. Please retry.');
}
