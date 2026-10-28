import type { Clip } from './types';
import { rampSpan, rampTimeAtSpan, validateSpeedRamp } from './speed-ramp';

export function validatePlaybackRate(clip: Pick<Clip, 'kind' | 'playbackRate'> & { duration?: number; speedRamp?: Clip['speedRamp'] }) {
  if (clip.speedRamp !== undefined) validateSpeedRamp({ ...clip, duration: clip.duration ?? 0 });
  if (clip.playbackRate === undefined) return;
  if (clip.kind !== 'video' && clip.kind !== 'audio') throw new Error('Playback speed applies to video and audio clips only.');
  if (!Number.isFinite(clip.playbackRate) || clip.playbackRate < .25 || clip.playbackRate > 4) throw new Error('Choose a playback speed between 0.25× and 4×.');
}
/** The constant rate; a ramped clip reports 1 here and maps time through its ramp below. */
export function playbackRateOf(clip: Pick<Clip, 'playbackRate'>) { return clip.playbackRate ?? 1; }
type Timed = Pick<Clip, 'playbackRate'> & { speedRamp?: Clip['speedRamp'] };
/** Source seconds consumed over clip-local `seconds`, through the speed ramp when there is one. */
export function sourceSpanOf(clip: Timed, seconds: number) { return clip.speedRamp?.length ? rampSpan(clip.speedRamp, seconds) : seconds * playbackRateOf(clip); }
export function sourceDurationOf(clip: Pick<Clip, 'duration'> & Timed) { return sourceSpanOf(clip, clip.duration); }
export function sourceEndOf(clip: Pick<Clip, 'sourceStart' | 'duration'> & Timed) { return clip.sourceStart + sourceDurationOf(clip); }
export function sourceTimeAt(clip: Pick<Clip, 'start' | 'sourceStart'> & Timed, timelineTime: number) { return clip.sourceStart + sourceSpanOf(clip, timelineTime - clip.start); }
export function timelineTimeAtSource(clip: Pick<Clip, 'start' | 'sourceStart'> & Timed, sourceTime: number) { return clip.start + (clip.speedRamp?.length ? rampTimeAtSpan(clip.speedRamp, sourceTime - clip.sourceStart) : (sourceTime - clip.sourceStart) / playbackRateOf(clip)); }
