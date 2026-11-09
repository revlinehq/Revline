import { timelineDuration, type Clip, type Timeline } from './types';

/** Clip fields that only change sound (or sign-off), never a rendered pixel. */
const SOUND_ONLY_FIELDS = new Set<keyof Clip>(['volume', 'audio', 'normalizedAudio', 'audioFadeTiming', 'audioSeparated', 'linkedClipId', 'approval', 'approvedSections']);

/** JSON with sorted object keys, so equal settings compare equal whatever order edits wrote them in. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/**
 * Everything an export's picture depends on: canvas, frame rate, resolution, encoder quality,
 * frame count and every visual clip (in paint order) without its sound settings. Two exports
 * with the same key have identical video streams, so the later one can reuse the earlier
 * picture and only mix its sound. Audio clips are left out except through the duration.
 * Markers stay in: scenes read music beats from them.
 */
export function exportVisualKey(timeline: Timeline, settings: { resolution: number; fps: number; quality: string }) {
  const clips = timeline.clips.filter(clip => clip.kind !== 'audio').map(clip => Object.fromEntries(Object.entries(clip).filter(([key]) => !SOUND_ONLY_FIELDS.has(key as keyof Clip))));
  return canonical({ version: 1, ...settings, timelineFps: timeline.fps, aspectRatio: timeline.aspectRatio, duration: timelineDuration(timeline), luts: timeline.luts, markers: timeline.markers, clips });
}
