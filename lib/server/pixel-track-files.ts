import { writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pixelTrackEndpoint, readPixelTrackPage, waitForTrackPoll } from '../media-analysis/pixel-track-reader';
import type { PixelTrackSummary } from '../media-analysis/pixel-track';
import type { Timeline } from '../editor/types';

/** Spool transport pages to local export resources without collecting the dense path in memory. */
export async function preparePixelTrackFiles(directory: string, timeline: Timeline, backend: string, signal: AbortSignal) {
  const references = new Map(timeline.clips.flatMap(clip => clip.pixelTracking ? [[clip.pixelTracking.reference.trackId, clip.pixelTracking.reference] as const] : []));
  for (const [trackId, reference] of references) {
    const prefix = `pixel-track-${encodeURIComponent(trackId)}`, chunks: { start: number; end: number; file: string }[] = [];
    let cursor: number | undefined, summary: PixelTrackSummary | undefined, sequence = 0;
    while (true) {
      signal.throwIfAborted();
      const page = await readPixelTrackPage(pixelTrackEndpoint(backend), reference, { cursor }, signal);
      if (page.status === 'failed') throw new Error(page.error);
      if (page.status === 'queued') { await waitForTrackPoll(signal); continue; }
      summary = page.summary;
      if (page.samples.length) {
        const file = `${prefix}-${sequence++}.json`;
        await writeFile(join(directory, file), JSON.stringify(page.samples));
        chunks.push({ start: page.samples[0].time, end: page.samples[page.samples.length - 1].time, file });
      }
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    await writeFile(join(directory, `${prefix}-index.json`), JSON.stringify({ summary, chunks }));
  }
}
export async function localPixelTrackFiles(directory: string) {
  const files: Record<string, string> = {};
  for (const name of await readdir(directory)) { const match = /^pixel-track-(.+)-index\.json$/.exec(name); if (match) files[decodeURIComponent(match[1])] = `./${name}`; }
  return files;
}
