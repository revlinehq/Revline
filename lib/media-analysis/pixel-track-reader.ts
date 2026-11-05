import { pixelTrackPage, pixelTrackFileIndex, pixelTrackSample, type PixelTrackPage } from './pixel-track';
import type { PixelTrackReference } from '../editor/types';
import { z } from 'zod';
import { abortableDelay } from './network';
export type CompletedTrackPage = Extract<PixelTrackPage, { status: 'completed' }>;

export function pixelTrackEndpoint(backend: string) {
  const url = new URL(backend);
  url.hostname = url.hostname.replace(/\.convex\.cloud$/, '.convex.site');
  url.pathname = '/pixel-track'; url.search = '';
  return url.href;
}
export async function readPixelTrackPage(endpoint: string, reference: PixelTrackReference, position: { time?: number; cursor?: number }, signal: AbortSignal): Promise<PixelTrackPage> {
  const url = new URL(endpoint);
  url.searchParams.set('trackId', reference.trackId); url.searchParams.set('token', reference.token);
  if (position.time !== undefined) url.searchParams.set('time', String(position.time));
  if (position.cursor !== undefined) url.searchParams.set('cursor', String(position.cursor));
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Track data is unavailable (HTTP ${response.status}).`);
  return pixelTrackPage.parse(await response.json());
}
export function waitForTrackPoll(signal: AbortSignal) {
  return abortableDelay(2000, signal);
}

/** Local export files and preview HTTP pages share the same dense sample contract. */
export function localPixelTrackReader(indexUrl: string, signal: AbortSignal) {
  const index = fetch(indexUrl, { signal }).then(async response => { if (!response.ok) throw new Error('Local track index is missing.'); return pixelTrackFileIndex.parse(await response.json()); });
  const cached = new Map<number, Promise<z.infer<typeof pixelTrackSample>[]>>();
  return async (time: number): Promise<CompletedTrackPage> => {
    const { summary, chunks } = await index;
    let low = 0, high = chunks.length;
    while (low < high) { const middle = (low + high) >>> 1; if (chunks[middle].start <= time) low = middle + 1; else high = middle; }
    const selected = Math.max(0, low - 1), wanted = [selected - 1, selected, selected + 1].filter(value => value >= 0 && value < chunks.length);
    for (const key of cached.keys()) if (!wanted.includes(key)) cached.delete(key);
    const samples = (await Promise.all(wanted.map(key => {
      let pending = cached.get(key);
      if (!pending) { pending = fetch(new URL(chunks[key].file, indexUrl), { signal }).then(async response => { if (!response.ok) throw new Error('Local track chunk is missing.'); return z.array(pixelTrackSample).parse(await response.json()); }); cached.set(key, pending); }
      return pending;
    }))).flat();
    return { status: 'completed', summary, samples, window: { start: chunks[selected]?.start ?? summary.firstTime, end: chunks[selected + 1]?.start ?? summary.forward.time }, nextCursor: chunks[selected + 1]?.start ?? null };
  };
}
