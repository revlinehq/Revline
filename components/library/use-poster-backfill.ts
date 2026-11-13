'use client';

import { useCallback } from 'react';
import { useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

/** Files this tab already tried, so a tile that re-renders (or a file shown in two places) stores at most once. */
const tried = new Set<string>();
/** One save at a time: a grid of older videos backfills one poster after another, never in a burst. */
let queue = Promise.resolve();

/** Stores the poster a Library tile drew for a video with none (a link import, or a file uploaded before posters were
 *  stored), so the next visit loads a small picture instead of the video. Convex keeps the first poster a file gets. */
export function usePosterBackfill() {
  const save = useAction(api.library.saveThumbnail);
  return useCallback((fileId: Id<'storageObjects'>) => (image: Blob) => {
    if (tried.has(fileId)) return;
    tried.add(fileId);
    queue = queue.then(async () => { await save({ fileId, image: await image.arrayBuffer() }); }).catch(() => undefined);
  }, [save]);
}
