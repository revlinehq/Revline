import { addTransitionClip, snapTime, splitClip } from './operations';
import { isTransitionClip, transitionPair, transitionSources, type ClipTransition, type TransitionPreset } from './clip-transitions';
import { TimelineGestureRejection } from './timeline-edit-errors';
import { normalizeTimeline, trackOf, type Timeline } from './types';

type PlacementOptions = { aboveClipId?: string; visualTrack?: number; track?: number; duration?: number } & Partial<Omit<ClipTransition,'fromClipId'|'toClipId'>>;
const tolerance = 1e-6;
const isFootage = (clip: Timeline['clips'][number]) => clip.kind === 'video' || clip.kind === 'image';

/** Resolve this position, never a distant cut. A new cut and its FX commit together. */
export function placeTransitionAt(input: Timeline, id: string, preset: TransitionPreset, at: number, options: PlacementOptions = {}): Timeline {
  const original = normalizeTimeline(input);
  if (!Number.isFinite(at) || at < 0) throw new TimelineGestureRejection('Drop the transition inside footage or onto a cut.');
  const previous = original.clips.find(clip => clip.id === id);
  if (previous && !isTransitionClip(previous)) throw new Error('Choose a transition clip to move.');
  let timeline = previous ? { ...original, clips: original.clips.filter(clip => clip.id !== id) } : original;
  const target = options.aboveClipId ? timeline.clips.find(clip => clip.id === options.aboveClipId) : undefined;
  if (options.aboveClipId && (!target || !isFootage(target))) throw new TimelineGestureRejection('Drop the transition onto video or image footage.');
  const media = timeline.clips.filter(isFootage);
  const visualTrack = options.visualTrack ?? (target ? trackOf(target) : Math.max(0, ...media.filter(clip => at >= clip.start - tolerance && at <= clip.start + clip.duration + tolerance).map(trackOf)));
  const lane = media.filter(clip => trackOf(clip) === visualTrack).sort((a, b) => a.start - b.start);
  // Snap only within half a frame, including fractional imported endpoints.
  const near = .5 / timeline.fps + tolerance;
  let from: typeof target, to: typeof target;
  for (let index = 1; index < lane.length; index++) {
    const left = lane[index - 1], right = lane[index], cut = left.start + left.duration;
    if (Math.abs(cut - right.start) <= tolerance && Math.abs(cut - at) <= near && (!target || target.id === left.id || target.id === right.id)) {
      from = left; to = right; break;
    }
  }
  if (!from || !to) {
    const candidates = lane.filter(clip => at > clip.start + tolerance && at < clip.start + clip.duration - tolerance && (!target || target.id === clip.id));
    if (candidates.length !== 1) throw new TimelineGestureRejection('Drop the transition inside footage or onto a cut.');
    const clip = candidates[0], cut = clip.start + snapTime(at - clip.start, timeline.fps);
    if (transitionSources(timeline.clips, timeline.fps).some(source => source.track === visualTrack && cut > source.clip.start - tolerance && cut < source.clip.start + source.clip.duration + tolerance)) {
      throw new TimelineGestureRejection('Transition ranges on the same V track cannot overlap.');
    }
    let tailId = `${id}-cut`;
    while (timeline.clips.some(member => member.id === tailId || member.id === `${tailId}-audio`)) tailId += '-';
    timeline = splitClip(timeline, clip.id, cut, tailId);
    from = timeline.clips.find(member => member.id === clip.id)!;
    to = timeline.clips.find(member => member.id === tailId)!;
  }
  const next = addTransitionClip(timeline, id, preset, from.id, to.id, options);
  if (!previous) return next;
  return { ...next, clips: next.clips.map(clip => clip.id === id ? { ...previous, ...clip, transition: { ...previous.transition!, ...clip.transition! } } : clip) };
}

/** Availability uses the exact same operation as a click; drag remains usable away from the playhead. */
export function transitionAvailabilityAt(timeline: Timeline, at: number, options: PlacementOptions = {}) {
  let id = 'transition-placement';
  while (timeline.clips.some(clip => clip.id === id)) id += '-';
  try { placeTransitionAt(timeline, id, 'crossfade', at, options); return { available: true as const }; }
  catch (error) { return { available: false as const, reason: error instanceof Error ? error.message : 'Drop the transition inside footage or onto a cut.' }; }
}

export function moveTransitionAt(timeline: Timeline, id: string, at: number, track: number) {
  const clip = timeline.clips.find(member => member.id === id);
  if (!clip || !isTransitionClip(clip)) throw new Error('Choose a transition clip to move.');
  const pair = transitionPair(timeline.clips, clip.transition!);
  const next = placeTransitionAt(timeline, id, clip.effectPreset as TransitionPreset, at, { visualTrack: pair.track, track, duration: clip.duration, direction: clip.transition!.direction });
  if (trackOf(next.clips.find(member => member.id === id)!) !== track) throw new TimelineGestureRejection('Overlaps a clip on this FX track.');
  return next;
}
