import type { Clip } from './types';

export const PLAYBACK_RATES = [.25, .5, 1, 1.5, 2, 4] as const;
export function validatePlaybackRate(clip: Pick<Clip, 'kind' | 'playbackRate'>) {
  if (clip.playbackRate === undefined) return;
  if (clip.kind !== 'video' && clip.kind !== 'audio') throw new Error('Playback speed applies to video and audio clips only.');
  if (!Number.isFinite(clip.playbackRate) || clip.playbackRate < .25 || clip.playbackRate > 4) throw new Error('Choose a playback speed between 0.25× and 4×.');
}
export function playbackRateOf(clip: Pick<Clip, 'playbackRate'>) { return clip.playbackRate ?? 1; }
export function sourceDurationOf(clip: Pick<Clip, 'duration' | 'playbackRate'>) { return clip.duration * playbackRateOf(clip); }
export function sourceEndOf(clip: Pick<Clip, 'sourceStart' | 'duration' | 'playbackRate'>) { return clip.sourceStart + sourceDurationOf(clip); }
export function sourceTimeAt(clip: Pick<Clip, 'start' | 'sourceStart' | 'playbackRate'>, timelineTime: number) { return clip.sourceStart + (timelineTime - clip.start) * playbackRateOf(clip); }
export function timelineTimeAtSource(clip: Pick<Clip, 'start' | 'sourceStart' | 'playbackRate'>, sourceTime: number) { return clip.start + (sourceTime - clip.sourceStart) / playbackRateOf(clip); }
