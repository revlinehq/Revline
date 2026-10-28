import { splitClip, snapTime } from './operations';
import { normalizeTimeline, type Clip, type Timeline } from './types';

export const FREEZE_MODES = ['insert', 'hold'] as const;
export type FreezeMode = typeof FREEZE_MODES[number];
export const MIN_FREEZE_SECONDS = .2, MAX_FREEZE_SECONDS = 10;

/** The still keeps the footage's framing and look, but none of its timing, sound or movement. */
function stillOf(clip: Clip, imageAssetId: string, id: string, start: number, duration: number): Clip {
  const {
    linkedClipId: _link, volume: _volume, playbackRate: _rate, speedRamp: _ramp, motion: _motion, motionOffset: _offset, effectKeyframes: _keys,
    focus: _focus, smoothZoom: _zoom, cameraMotion: _camera, visualFade: _fade, visualFadeTiming: _fadeTiming, transition: _transition,
    audio: _audio, audioFadeTiming: _audioFade, audioSeparated: _separated, mask: _mask, ...look
  } = clip;
  return { ...look, id, kind: 'image', assetId: imageAssetId, start, duration, sourceStart: 0 } as Clip;
}

/**
 * Freeze one video clip's frame at timeline time `at` for `duration` seconds, using a still of that frame.
 * insert: the timeline grows; everything from `at` on moves later and the clip resumes after the still.
 * hold: the still replaces the next `duration` of picture while the clip's sound plays on, then the video resumes in sync.
 */
export function insertFreezeFrame(input: Timeline, clipId: string, at: number, duration: number, mode: FreezeMode, imageAssetId: string, newId: () => string): Timeline {
  let timeline = normalizeTimeline(input);
  const clip = timeline.clips.find(item => item.id === clipId);
  if (!clip || clip.kind !== 'video') throw new Error('Freeze a video clip.');
  const frame = 1 / timeline.fps, end = clip.start + clip.duration;
  at = snapTime(at, timeline.fps); duration = snapTime(duration, timeline.fps);
  if (at < clip.start - 1e-6 || at > end + 1e-6) throw new Error('Choose a time inside the clip to freeze.');
  if (duration < Math.max(frame, MIN_FREEZE_SECONDS - 1e-6) || duration > MAX_FREEZE_SECONDS) throw new Error(`Freeze for ${MIN_FREEZE_SECONDS} to ${MAX_FREEZE_SECONDS} seconds.`);
  const stillId = newId();
  if (mode === 'insert') {
    if (at > clip.start + frame / 2 && at < end - frame / 2) timeline = splitClip(timeline, clipId, at, newId());
    // Ripple: everything starting at or after the freeze moves later, keeping sync across layers.
    const moved = timeline.clips.map(item => item.start >= at - 1e-6 ? { ...item, start: item.start + duration } : item);
    const markers = timeline.markers?.map(marker => marker.time >= at - 1e-6 ? { ...marker, time: marker.time + duration } : marker);
    return normalizeTimeline({ ...timeline, ...(markers ? { markers } : {}), clips: [...moved, stillOf(clip, imageAssetId, stillId, at, duration)] });
  }
  if (end - at < frame) throw new Error('Hold a frame before the clip ends, or use insert mode.');
  const holdEnd = Math.min(end, at + duration);
  let middleId = clipId;
  if (at > clip.start + frame / 2) { middleId = newId(); timeline = splitClip(timeline, clipId, at, middleId); }
  if (holdEnd < end - frame / 2) timeline = splitClip(timeline, middleId, holdEnd, newId());
  const middle = timeline.clips.find(item => item.id === middleId)!;
  // The held picture becomes the still; its sound piece plays on unlinked.
  const clips = timeline.clips.flatMap(item => item.id === middleId ? [stillOf(middle, imageAssetId, stillId, middle.start, middle.duration)]
    : item.id === middle.linkedClipId ? [{ ...item, linkedClipId: undefined }] : [item]);
  return normalizeTimeline({ ...timeline, clips });
}
