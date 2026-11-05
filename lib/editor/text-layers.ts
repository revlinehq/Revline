import { motionAt, NEUTRAL_MOTION } from './motion-path';
import { cssMotionBlur } from './camera-motion-blur';
import { textStyle } from './text-style';
import type { Clip } from './types';

export type TextLayerSource = { clip: Clip; index: number; fps: number; resolution: number };
export function textLayerSources(clips: Clip[], fps: number, resolution = 1080): TextLayerSource[] {
  return clips.flatMap((clip, index) => clip.kind === 'caption' || clip.kind === 'graphic' ? [{ clip, index, fps, resolution }] : []);
}

/** Text entrances use the same source time as templates, without deferred tween setup. */
export function textLayerFrame(source: TextLayerSource, time: number, width: number, height: number) {
  const { clip, resolution } = source, local = time - clip.start;
  const motion = clip.motion?.length ? motionAt(clip.motion, local + (clip.motionOffset ?? 0)) : NEUTRAL_MOTION;
  const animationLocal = local + (clip.textAnimationTiming?.offset ?? 0);
  const animationDuration = clip.textAnimationTiming?.duration ?? clip.duration;
  const duration = Math.min(.3, animationDuration / 3);
  const fade = clip.animation === 'fade' || clip.animation === 'rise';
  const enter = Math.max(0, Math.min(1, animationLocal / duration)), exit = Math.max(0, Math.min(1, (animationLocal - animationDuration + duration) / duration));
  const opacity = fade ? Math.min(1 - (1 - enter) ** 3, (1 - exit) ** 2) : 1;
  const lift = clip.animation === 'rise' ? (1 - enter) ** 3 * 32 * resolution / 1080 : 0;
  return {
    style: textStyle(clip, resolution), visible: local >= 0 && local < clip.duration,
    transform: `translate(${motion.x * width}px,${motion.y * height}px) rotate(${motion.rotation}deg) scale(${motion.scale})`,
    opacity: motion.opacity * opacity, lift, brightness: motion.brightness,
    blur: clip.motion?.length ? cssMotionBlur(clip.motion, local + (clip.motionOffset ?? 0), clip.motionBlur, width, height) * resolution / 1080 : 0,
  };
}
