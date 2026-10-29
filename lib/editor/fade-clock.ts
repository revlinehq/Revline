import type { Clip } from './types';

type FadeTiming = { duration: number; offset: number };
type Span = Pick<Clip, 'start' | 'duration'>;
const EPSILON = 1e-6;

/**
 * Move a frozen fade clock through an edge edit. An edge that carries the authored fade follows the
 * new edge; an inner split/trim edge keeps its retained samples. The clock always covers the clip, so
 * extending never leaves a silent or black tail. A clock equal to the clip span is dropped.
 */
function anchorFadeClock(before: Span, timing: FadeTiming | undefined, after: Span): FadeTiming | undefined {
  const clockStart = before.start - (timing?.offset ?? 0), clockEnd = clockStart + (timing?.duration ?? before.duration);
  const start = Math.abs(clockStart - before.start) <= EPSILON ? after.start : Math.min(clockStart, after.start);
  const end = Math.abs(clockEnd - before.start - before.duration) <= EPSILON ? after.start + after.duration : Math.max(clockEnd, after.start + after.duration);
  const offset = after.start - start, duration = end - start;
  return Math.abs(offset) <= EPSILON && Math.abs(duration - after.duration) <= EPSILON ? undefined : { duration, offset };
}

/** Fade timing for a clip whose edges moved from `before` to `after` (timeline seconds). */
export function anchoredFadeTimingPatch(before: Clip, after: Span): Partial<Pick<Clip, 'audioFadeTiming' | 'visualFadeTiming'>> {
  const audio = before.kind === 'audio' && (before.audioFadeTiming || (before.audio?.fadeIn ?? 0) > 0 || (before.audio?.fadeOut ?? 0) > 0);
  const visual = (before.kind === 'video' || before.kind === 'image') && (before.visualFadeTiming || (before.visualFade?.fadeIn ?? 0) > 0 || (before.visualFade?.fadeOut ?? 0) > 0);
  return {
    ...(audio ? { audioFadeTiming: anchorFadeClock(before, before.audioFadeTiming, after) } : {}),
    ...(visual ? { visualFadeTiming: anchorFadeClock(before, before.visualFadeTiming, after) } : {}),
  };
}
