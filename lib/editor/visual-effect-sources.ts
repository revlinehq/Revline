import { cameraGlideBlurSource } from './camera-motion-blur';
import { hasReactiveEffects } from './audio-reactive';
import { colorFinishSource, type TimelineLut } from './color-finish';
import type { Clip } from './types';
import { visualEffectsOf } from './visual-effects';

/** The WebGL effect data for one video or image clip, as the composition installs it and the live preview updates it. */
export function clipVisualEffectSource(clip: Clip, luts?: TimelineLut[]) {
  return { ...visualEffectsOf(clip), parallax: clip.parallax, cameraGlideBlur: cameraGlideBlurSource(clip), effectKeyframes: clip.effectKeyframes, motionOffset: clip.motionOffset, ...(clip.blurRegions?.length ? { blurRegions: clip.blurRegions, regionClock: { sourceStart: clip.sourceStart, playbackRate: clip.playbackRate, speedRamp: clip.speedRamp } } : {}), ...(hasReactiveEffects(clip.audioReactive) ? { audioReactive: clip.audioReactive } : {}), ...(colorFinishSource(clip, luts) ? { colorFinish: colorFinishSource(clip, luts) } : {}) };
}
