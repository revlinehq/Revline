import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ConvexHttpClient } from 'convex/browser';
import type { FunctionArgs } from 'convex/server';
import { api } from '@/convex/_generated/api';
import { forEachLimited } from './run-limited';

export type UploadContext = {
  convex: ConvexHttpClient; refreshAuth: () => Promise<void>;
  /** Runs a call that writes the media task's row so it never overlaps a lease renewal. */
  exclusive?: <T>(run: () => Promise<T>) => Promise<T>;
};

export async function uploadMediaFile(path: string, metadata: Omit<FunctionArgs<typeof api.r2.start>, 'size'>, context: UploadContext, signal: AbortSignal) {
  const { size } = await stat(path);
  const exclusive = context.exclusive ?? (<T,>(run: () => Promise<T>) => run());
  await context.refreshAuth();
  const upload = await exclusive(() => context.convex.action(api.r2.start, { ...metadata, size }));
  const taskAuth = metadata.taskId ? { taskId: metadata.taskId, leaseToken: metadata.leaseToken } : {};
  let completed = false;
  try {
    const parts: { partNumber: number; etag: string }[] = [];
    // Parts are independent. A few in flight hide per-part URL signing and
    // request latency; each part keeps its own three attempts.
    await forEachLimited(Array.from({ length: upload.partCount }, (_, index) => index + 1), 4, async (partNumber, stop) => {
      const partSignal = AbortSignal.any([signal, stop]);
      const start = (partNumber - 1) * upload.partSize, end = Math.min(size, start + upload.partSize) - 1;
      for (let attempt = 0; attempt < 3; attempt++) {
        partSignal.throwIfAborted(); await context.refreshAuth();
        const url = await context.convex.action(api.r2.partUrl, { uploadId: upload.uploadId, partNumber, ...taskAuth });
        const body = createReadStream(path, { start, end });
        try {
          const response = await fetch(url, { method: 'PUT', headers: { 'Content-Length': String(end - start + 1) }, body: body as unknown as BodyInit, signal: partSignal, duplex: 'half' } as RequestInit & { duplex: 'half' });
          if (!response.ok) throw new Error(`Could not store media (HTTP ${response.status}).`);
          const part = await response.json() as { partNumber: number; etag: string };
          if (part.partNumber !== partNumber || !part.etag) throw new Error('The media upload returned an invalid part.');
          parts.push(part); break;
        } catch (error) { if (attempt === 2 || partSignal.aborted) throw error; }
        finally { body.destroy(); }
      }
    });
    // Completion requires parts in ascending order.
    parts.sort((a, b) => a.partNumber - b.partNumber);
    await context.refreshAuth();
    const assetId = await exclusive(() => context.convex.action(api.r2.complete, { uploadId: upload.uploadId, parts, ...taskAuth }));
    completed = true; return assetId;
  } finally {
    if (!completed) {
      try { await context.refreshAuth(); await exclusive(() => context.convex.action(api.r2.abort, { uploadId: upload.uploadId, ...taskAuth })); }
      catch { /* Expired upload leases also reclaim incomplete media. */ }
    }
  }
}
