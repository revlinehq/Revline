import { addEffectClip, addMediaClip, patchClip, snapTime } from './operations';
import { NEUTRAL_MOTION } from './clip-effects';
import { normalizeTimeline, trackOf, type MediaAsset, type Timeline } from './types';

/** A transition is centered on an existing cut; no source timing or sound moves. */
export function addFadeThroughBlack(timeline: Timeline, clipId: string, id: string): Timeline {
  const outgoing = timeline.clips.find(clip => clip.id === clipId && (clip.kind === 'video' || clip.kind === 'image'));
  if (!outgoing) throw new Error('Select footage at a cut first.');
  const cut = outgoing.start + outgoing.duration;
  const incoming = timeline.clips.find(clip => clip.id !== clipId && (clip.kind === 'video' || clip.kind === 'image') && trackOf(clip) === trackOf(outgoing) && Math.abs(clip.start - cut) < .5 / timeline.fps);
  if (!incoming) throw new Error('Select a clip followed by another piece of footage.');
  const half = Math.floor(Math.min(.3, outgoing.duration / 2, incoming.duration / 2) * timeline.fps) / timeline.fps;
  if (half < 1 / timeline.fps) throw new Error('This cut needs at least two frames on each side.');
  const duration = half * 2;
  const next = addEffectClip(timeline, id, 'fade', snapTime(cut - half, timeline.fps), { duration });
  return patchClip(next, id, { effectPreset: 'none', motion: [
    { ...NEUTRAL_MOTION, time: 0 }, { ...NEUTRAL_MOTION, time: half, opacity: 0 }, { ...NEUTRAL_MOTION, time: duration },
  ] });
}

export function addOverlayClip(timeline: Timeline, asset: MediaAsset, id: string, at: number): Timeline {
  if (asset.kind === 'audio' || !asset.url) throw new Error('Choose an available video or image overlay.');
  timeline = normalizeTimeline(timeline);
  const beneath = timeline.clips.filter(clip => clip.kind !== 'audio' && clip.kind !== 'effect' && clip.start <= at && clip.start + clip.duration > at);
  const track = Math.max(0, ...beneath.map(trackOf)) + 1;
  return addMediaClip(timeline, asset, id, at, track);
}
