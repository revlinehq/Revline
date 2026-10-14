import { linkedClipIds, placeOnFreeLayer } from './operations';
import { type Clip, type Timeline } from './types';
import { isTransitionClip, transitionSources } from './clip-transitions';

export function copyTimelineClips(timeline: Timeline, selectedIds: string[]): Clip[] {
  const ids = new Set(linkedClipIds(timeline, selectedIds));
  return structuredClone(timeline.clips.filter(clip => ids.has(clip.id)));
}

export function pasteTimelineClips(timeline: Timeline, source: Clip[], time: number, newId: () => string = () => crypto.randomUUID()) {
  if (!source.length) return { timeline, ids: [] as string[] };
  if (!Number.isFinite(time)) throw new Error('Choose a valid paste position.');
  const start = Math.max(0, Math.round(time * timeline.fps) / timeline.fps);
  const first = Math.min(...source.map(clip => clip.start));
  const ids = new Map(source.map(clip => [clip.id, newId()]));
  for(const clip of source)if(isTransitionClip(clip)&&(!ids.has(clip.transition!.fromClipId)||!ids.has(clip.transition!.toClipId)))throw new Error('Copy both connected clips with their transition to paste it.');
  const copies = structuredClone(source).map(clip => ({
    ...clip,
    id: ids.get(clip.id)!,
    linkedClipId: clip.linkedClipId ? ids.get(clip.linkedClipId) : undefined,
    ...(clip.transition ? {transition:{...clip.transition,fromClipId:ids.get(clip.transition.fromClipId)!,toClipId:ids.get(clip.transition.toClipId)!}} : {}),
    start: start + clip.start - first,
  }));
  let next = timeline;
  for (const clip of [...copies.filter(clip=>!isTransitionClip(clip)),...copies.filter(isTransitionClip)]) next = placeOnFreeLayer(next, clip);
  transitionSources(next.clips,next.fps);
  return { timeline: next, ids: copies.map(clip => clip.id) };
}
