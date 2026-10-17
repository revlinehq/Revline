import { offsetClipMotion } from './clip-effects';
import { isTransitionClip, reconcileTransitionEdits } from './clip-transitions';
import { playbackRateOf, sourceEndOf } from './playback-rate';
import { layerGroup, normalizeTimeline, trackOf, type Clip, type Timeline } from './types';

const epsilon = 1e-6;
const media = (clip: Clip) => clip.kind === 'video' || clip.kind === 'audio' || clip.kind === 'image';
const sameTime = (a: number, b: number) => Math.abs(a - b) <= epsilon;
function sameSettings(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return sameTime(a, b);
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => sameSettings(value, b[index]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].every(key => sameSettings(left[key], right[key]));
}
function appearance(clip: Clip) {
  const { id: _id, start: _start, duration: _duration, sourceStart: _sourceStart, linkedClipId: _linked, ...settings } = clip;
  return { ...settings, track: trackOf(clip), playbackRate: playbackRateOf(clip), motionOffset: clip.motion?.length ? clip.motionOffset ?? 0 : undefined };
}
function mergeChain(pieces: Clip[]): Clip {
  const first = pieces[0];
  for (let index = 1; index < pieces.length; index++) {
    const previous = pieces[index - 1], current = pieces[index];
    if (!media(current) || current.kind !== first.kind || !first.assetId || current.assetId !== first.assetId) throw new Error('Merge clips needs split pieces from the same uploaded source.');
    if (trackOf(current) !== trackOf(first)) throw new Error('Move the split pieces onto the same track before merging.');
    if (!sameTime(previous.start + previous.duration, current.start)) throw new Error('The split pieces must touch on the timeline. Close their gaps first.');
    if (!sameTime(sourceEndOf(previous), current.sourceStart)) throw new Error('These pieces skip source footage. Merging them would restore deleted frames; keep the cut between them.');
    const expected = { ...first, ...offsetClipMotion(first, current.start - first.start) };
    if (!sameSettings(appearance(expected), appearance(current))) throw new Error('These pieces have different settings or animation timing. Match their effects, volume and transforms before merging.');
  }
  return { ...first, duration: pieces.at(-1)!.start + pieces.at(-1)!.duration - first.start };
}

/** Remove split boundaries, never source edits: one clip represents one continuous source range. */
export function mergeSplitClips(input: Timeline, selectedIds: readonly string[]): { timeline: Timeline; mergedClipIds: string[] } {
  const timeline = normalizeTimeline(input), byId = new Map(timeline.clips.map(clip => [clip.id, clip]));
  const primary = (clip: Clip) => {
    const linked = clip.linkedClipId ? byId.get(clip.linkedClipId) : undefined;
    return clip.kind === 'audio' && linked?.kind === 'video' && linked.linkedClipId === clip.id ? linked : clip;
  };
  let selected = [...new Map(selectedIds.flatMap(id => { const clip = byId.get(id); return clip ? [[primary(clip).id, primary(clip)] as const] : []; })).values()];
  if (!selected.length) throw new Error('Select adjacent split pieces to merge, or select one piece next to its split neighbor.');
  if (selected.some(clip => !media(clip))) throw new Error('Select split video, image or audio clips to merge.');

  // A single selected half can reunite with the next compatible half, or the previous one.
  if (selected.length === 1) {
    const clip = selected[0], row = timeline.clips.filter(other => !isTransitionClip(other) && layerGroup(other.kind) === layerGroup(clip.kind) && trackOf(other) === trackOf(clip)).sort((a, b) => a.start - b.start);
    const index = row.findIndex(other => other.id === clip.id);
    let failure: unknown;
    for (const neighbor of [row[index + 1], row[index - 1]]) {
      if (!neighbor) continue;
      const pieces = [clip, neighbor].sort((a, b) => a.start - b.start);
      try { mergeChain(pieces); selected = pieces; break; } catch (error) { failure ??= error; }
    }
    if (selected.length === 1) throw failure ?? new Error('Select adjacent split pieces from the same source to merge.');
  }
  const groups = new Map<string, Clip[]>();
  for (const clip of selected) {
    const key = `${clip.kind}:${trackOf(clip)}:${clip.assetId ?? ''}`, group = groups.get(key) ?? [];
    group.push(clip); groups.set(key, group);
  }
  const chains = [...groups.values()].filter(group => group.length > 1).map(group => group.sort((a, b) => a.start - b.start));
  if (!chains.length) throw new Error('Select neighboring split pieces from the same source and track.');
  const replacements = new Map<string, Clip>(), remap = new Map<string, string>(), mergedClipIds: string[] = [];
  for (const pieces of chains) {
    const merged = mergeChain(pieces), ids = new Set(pieces.map(clip => clip.id));
    if (timeline.clips.some(clip => clip.transition && ids.has(clip.transition.fromClipId) && ids.has(clip.transition.toClipId))) throw new Error('Remove the transition between these pieces before merging them.');
    const partners = pieces.map(clip => clip.linkedClipId ? byId.get(clip.linkedClipId) : undefined);
    if (partners.some(Boolean)) {
      if (merged.kind !== 'video' || partners.some((partner, index) => !partner || partner.kind !== 'audio' || partner.linkedClipId !== pieces[index].id || !sameTime(partner.start, pieces[index].start) || !sameTime(partner.duration, pieces[index].duration))) throw new Error('Each split piece needs its matching linked audio before merging.');
      const linked = mergeChain(partners as Clip[]);
      replacements.set(linked.id, { ...linked, linkedClipId: merged.id });
      for (const partner of partners as Clip[]) remap.set(partner.id, linked.id);
      merged.linkedClipId = linked.id;
    }
    replacements.set(merged.id, merged); mergedClipIds.push(merged.id);
    for (const piece of pieces) remap.set(piece.id, merged.id);
  }
  const clips = timeline.clips.flatMap(clip => {
    if (remap.has(clip.id)) return remap.get(clip.id) === clip.id ? [replacements.get(clip.id)!] : [];
    if (!clip.transition) return [clip];
    return [{ ...clip, transition: { ...clip.transition, fromClipId: remap.get(clip.transition.fromClipId) ?? clip.transition.fromClipId, toClipId: remap.get(clip.transition.toClipId) ?? clip.transition.toClipId } }];
  });
  return { timeline: reconcileTransitionEdits(timeline, { ...timeline, clips }), mergedClipIds };
}
