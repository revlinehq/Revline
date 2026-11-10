import type { Clip, Timeline, VisualFadeSettings } from './types';

export const VISUAL_FADE_MAX_SECONDS = 86400;
const DEFAULT_VISUAL_FADE: Readonly<VisualFadeSettings> = { fadeIn: 0, fadeOut: 0 };
type FadeClip = Pick<Clip, 'kind' | 'duration' | 'visualFade' | 'visualFadeTiming'>;

export function validateVisualFade(clip: FadeClip) {
  if (clip.visualFade === undefined && clip.visualFadeTiming === undefined) return;
  if (clip.kind !== 'video' && clip.kind !== 'image') throw new Error('Visual fades apply to video and image clips.');
  if (clip.visualFade) for (const value of [clip.visualFade.fadeIn, clip.visualFade.fadeOut]) {
    if (!Number.isFinite(value) || value < 0 || value > VISUAL_FADE_MAX_SECONDS) throw new Error('Visual fade seconds must be finite and between 0 and 86400.');
  }
  const timing = clip.visualFadeTiming;
  if (clip.visualFade && clip.visualFade.fadeIn + clip.visualFade.fadeOut > (timing?.duration ?? clip.duration) + 1e-7) throw new Error('Visual fades together cannot exceed their original clip duration.');
  if (timing && (!Number.isFinite(timing.duration) || timing.duration <= 0 || !Number.isFinite(timing.offset))) throw new Error('Visual fade timing needs a positive finite duration and finite offset.');
}

/** Edge controls fit the retained clip. Explicit edits begin a new fade clock. */
function visualFadeSettings(clip: Pick<Clip, 'duration' | 'visualFade' | 'visualFadeTiming'>): VisualFadeSettings {
  const settings = clip.visualFade ?? DEFAULT_VISUAL_FADE, total = settings.fadeIn + settings.fadeOut;
  const duration = clip.visualFadeTiming?.duration ?? clip.duration, scale = total > duration && total > 0 ? duration / total : 1;
  const fadeIn = settings.fadeIn * scale, fadeOut = settings.fadeOut * scale;
  if (clip.visualFadeTiming) return {
    fadeIn: Math.max(0, Math.min(clip.duration, fadeIn - clip.visualFadeTiming.offset)),
    fadeOut: Math.max(0, Math.min(clip.duration, clip.visualFadeTiming.offset + clip.duration - duration + fadeOut)),
  };
  return { fadeIn, fadeOut };
}

/**
 * The fade clock visualFadeGain samples: edge seconds on the original duration (scaled to fit it)
 * and where the retained clip starts in it. gain(elapsed) = in(elapsed + offset) * out(duration - (elapsed + offset)).
 */
export function visualFadeClock(clip: Pick<Clip, 'duration' | 'visualFade' | 'visualFadeTiming'>) {
  const duration = clip.visualFadeTiming?.duration ?? clip.duration;
  const { fadeIn, fadeOut } = visualFadeSettings({ duration, visualFade: clip.visualFade });
  return { fadeIn, fadeOut, duration, offset: clip.visualFadeTiming?.offset ?? 0 };
}

/** Sample the original opacity phase, including retained split/trim offsets. */
export function visualFadeGain(clip: Pick<Clip, 'duration' | 'visualFade' | 'visualFadeTiming'>, elapsed: number) {
  const duration = clip.visualFadeTiming?.duration ?? clip.duration;
  const { fadeIn, fadeOut } = visualFadeSettings({ duration, visualFade: clip.visualFade });
  const time = elapsed + (clip.visualFadeTiming?.offset ?? 0), clamp = (value: number) => Math.max(0, Math.min(1, value));
  return (fadeIn > 0 ? clamp(time / fadeIn) : 1) * (fadeOut > 0 ? clamp((duration - time) / fadeOut) : 1);
}

export function visualFadeTimingPatch(clip: FadeClip, delta = 0): Pick<Clip, 'visualFadeTiming'> | Record<string, never> {
  return (clip.kind === 'video' || clip.kind === 'image') && (clip.visualFadeTiming || (clip.visualFade?.fadeIn ?? 0) > 0 || (clip.visualFade?.fadeOut ?? 0) > 0)
    ? { visualFadeTiming: { duration: clip.visualFadeTiming?.duration ?? clip.duration, offset: (clip.visualFadeTiming?.offset ?? 0) + delta } } : {};
}

/** Shared manual/agent edit: retain the opposite edge and start one new fade clock. */
export function visualFadePatch(clip: Clip, patch: Partial<VisualFadeSettings>): Partial<Clip> {
  if (clip.kind !== 'video' && clip.kind !== 'image') throw new Error('Choose a video or image clip for a visual fade.');
  if (patch.fadeIn === undefined && patch.fadeOut === undefined) throw new Error('Specify a visual fade in or fade out.');
  const visualFade = { ...visualFadeSettings(clip), ...patch };
  validateVisualFade({ ...clip, visualFade });
  if (visualFade.fadeIn + visualFade.fadeOut > clip.duration + 1e-7) throw new Error('Visual fades together cannot exceed the retained clip duration.');
  return { visualFade, visualFadeTiming: undefined };
}

export function configureVisualFade(timeline: Timeline, id: string, patch: Partial<VisualFadeSettings>): Timeline {
  const clip = timeline.clips.find(member => member.id === id);
  if (!clip) throw new Error('Choose a video or image clip for a visual fade.');
  const changes = visualFadePatch(clip, patch);
  return { ...timeline, clips: timeline.clips.map(member => member.id === id ? { ...member, ...changes } : member) };
}
