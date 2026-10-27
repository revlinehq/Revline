import { offsetClipMotion } from './clip-effects';
import { isTransitionClip } from './clip-transitions';
import { playbackRateOf, sourceEndOf } from './playback-rate';
import type { Clip, Timeline } from './types';

export type SplitEditKind = 'J' | 'L';
export const MAX_SPLIT_EDIT_SECONDS = 2;
const epsilon = 1e-3;

/**
 * A J or L cut at the join after video `clipId`. Sound stays exactly where it is; only the picture's
 * edit point moves, so speech cleanup and its millisecond edges are untouched.
 * L: the outgoing sound carries over the incoming picture (the picture changes `seconds` early).
 * J: the incoming sound starts under the outgoing picture (the picture changes `seconds` late).
 * The extra picture comes from each source's footage beside the kept piece. Both pictures are
 * unlinked from their sound, since they no longer share its timing.
 */
export function applySplitEdit(timeline: Timeline, clipId: string, kind: SplitEditKind, seconds: number, sourceDuration: (assetId: string) => number | undefined): Timeline {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_SPLIT_EDIT_SECONDS) throw new Error(`Choose a J/L offset between 0 and ${MAX_SPLIT_EDIT_SECONDS} seconds.`);
  const outgoing = timeline.clips.find(clip => clip.id === clipId);
  if (!outgoing || outgoing.kind !== 'video') throw new Error('Choose the video clip before the cut.');
  const end = outgoing.start + outgoing.duration;
  const incoming = timeline.clips.find(clip => clip.kind === 'video' && clip.id !== outgoing.id && clip.track === outgoing.track && Math.abs(clip.start - end) < epsilon);
  if (!incoming) throw new Error('There is no video clip directly after this one on its layer to make a J or L cut with.');
  const ids = new Set([outgoing.id, incoming.id]);
  if (timeline.clips.some(clip => isTransitionClip(clip) && clip.transition && (ids.has(clip.transition.fromClipId) || ids.has(clip.transition.toClipId)))) throw new Error('Remove the transition at this cut before making a J or L cut.');
  const frame = 1 / timeline.fps, outRate = playbackRateOf(outgoing), inRate = playbackRateOf(incoming);
  let nextOut: Clip, nextIn: Clip;
  if (kind === 'L') {
    if (outgoing.duration - seconds < frame) throw new Error('The clip before the cut is too short for this L cut.');
    if (incoming.sourceStart - seconds * inRate < -1e-6) throw new Error('The next clip has no earlier footage to show under the carried-over sound.');
    nextOut = { ...outgoing, duration: outgoing.duration - seconds };
    nextIn = { ...incoming, ...offsetClipMotion(incoming, -seconds), start: incoming.start - seconds, sourceStart: Math.max(0, incoming.sourceStart - seconds * inRate), duration: incoming.duration + seconds };
  } else {
    if (incoming.duration - seconds < frame) throw new Error('The clip after the cut is too short for this J cut.');
    const available = outgoing.assetId ? sourceDuration(outgoing.assetId) : undefined;
    if (available !== undefined && sourceEndOf(outgoing) + seconds * outRate > available + 1e-6) throw new Error('The clip before the cut has no later footage to show under the incoming sound.');
    nextOut = { ...outgoing, duration: outgoing.duration + seconds };
    nextIn = { ...incoming, ...offsetClipMotion(incoming, seconds), start: incoming.start + seconds, sourceStart: incoming.sourceStart + seconds * inRate, duration: incoming.duration - seconds };
  }
  const partners = new Set([outgoing.linkedClipId, incoming.linkedClipId].filter(Boolean) as string[]);
  return { ...timeline, clips: timeline.clips.map(clip => clip.id === outgoing.id ? { ...nextOut, linkedClipId: undefined } : clip.id === incoming.id ? { ...nextIn, linkedClipId: undefined } : partners.has(clip.id) && ids.has(clip.linkedClipId ?? '') ? { ...clip, linkedClipId: undefined } : clip) };
}
