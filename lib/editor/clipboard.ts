import { linkedClipIds, placeOnFreeLayer, rangesOverlap } from './operations';
import { layerGroup, maxTrackCount, normalizeTimeline, TIMELINE_LAYER_GROUPS, trackOf, type Clip, type Timeline, type TransitionPreset } from './types';
import { isTransitionClip, transitionSources } from './clip-transitions';
import { placeTransitionAt } from './transition-placement';

export function copyTimelineClips(timeline: Timeline, selectedIds: string[]): Clip[] {
  const ids = new Set(linkedClipIds(timeline, selectedIds));
  return structuredClone(timeline.clips.filter(clip => ids.has(clip.id)));
}

export function pasteTimelineClips(timeline: Timeline, source: Clip[], time: number, newId: () => string = () => crypto.randomUUID(), target: { visualTrack?: number } = {}) {
  if (!source.length) return { timeline, ids: [] as string[] };
  if (!Number.isFinite(time)) throw new Error('Choose a valid paste position.');
  timeline = normalizeTimeline(timeline);
  const start = Math.max(0, Math.round(time * timeline.fps) / timeline.fps);
  // A transition-only clipboard is a reusable effect, not a copy of its footage.
  // Align the first cut to the playhead and resolve new source clips there.
  if (source.every(isTransitionClip)) {
    const firstCut = Math.min(...source.map(clip => clip.start + clip.duration / 2));
    const ids: string[] = [];
    let next = timeline;
    for (const clip of source) {
      const id = newId();
      const placed = placeTransitionAt(next, id, clip.effectPreset as TransitionPreset, start + clip.start + clip.duration / 2 - firstCut, { ...clip.transition!, duration: clip.duration, track: clip.track, visualTrack: target.visualTrack });
      next = { ...placed, clips: placed.clips.map(member => member.id === id ? { ...structuredClone(clip), ...member } : member) };
      ids.push(id);
    }
    return { timeline: next, ids };
  }
  const first = Math.min(...source.map(clip => clip.start));
  const ids = new Map(source.map(clip => [clip.id, newId()]));
  for(const clip of source)if(isTransitionClip(clip)&&(!ids.has(clip.transition!.fromClipId)||!ids.has(clip.transition!.toClipId)))throw new Error('Copy the transition on its own, or select both connected clips to copy the whole sequence.');
  let copies = structuredClone(source).map(clip => ({
    ...clip,
    id: ids.get(clip.id)!,
    linkedClipId: clip.linkedClipId ? ids.get(clip.linkedClipId) : undefined,
    ...(clip.transition ? {transition:{...clip.transition,fromClipId:ids.get(clip.transition.fromClipId)!,toClipId:ids.get(clip.transition.toClipId)!}} : {}),
    start: start + clip.start - first,
  }));
  // Move each copied stack together: independent free-row placement can split
  // a transition's two source clips, or put a copied caption below its footage.
  for (const group of TIMELINE_LAYER_GROUPS) {
    const members = copies.filter(clip => layerGroup(clip.kind) === group);
    if (!members.length) continue;
    const maximum = maxTrackCount(group), highest = Math.max(...members.map(trackOf));
    let offset = 0;
    while (highest + offset <= maximum && members.some(clip => timeline.clips.some(other => layerGroup(other.kind) === group
      && trackOf(other) === trackOf(clip) + offset && rangesOverlap(other, clip)))) offset++;
    if (highest + offset > maximum) throw new Error(`There is no room for this selection within ${maximum} layers. Paste at another time or remove a layer.`);
    copies = copies.map(clip => layerGroup(clip.kind) === group ? { ...clip, track: trackOf(clip) + offset } : clip);
  }
  let next = timeline;
  for (const clip of [...copies.filter(clip=>!isTransitionClip(clip)),...copies.filter(isTransitionClip)]) next = placeOnFreeLayer(next, clip);
  transitionSources(next.clips,next.fps);
  return { timeline: next, ids: copies.map(clip => clip.id) };
}
