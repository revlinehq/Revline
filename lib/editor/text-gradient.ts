import { motionEase } from './motion-path';

export type TextGradient = {
  colors: string[];
  angle: number;
  animation?: { duration: number; direction: 'forward' | 'reverse'; loop: boolean };
  offset?: number;
};
export const DEFAULT_TEXT_GRADIENT: TextGradient = { colors: ['#FFFFFF', '#A78BFA'], angle: 90 };
export type TextGradientChanges = { enabled: boolean; colors?: string[]; angle?: number; animation?: { enabled: boolean; duration?: number; direction?: 'forward' | 'reverse'; loop?: boolean } };
const hex = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;

export function validateTextGradient(clip: { kind: string; textGradient?: TextGradient }) {
  const gradient = clip.textGradient;
  if (gradient === undefined) return;
  if (!['caption', 'graphic'].includes(clip.kind)) throw new Error('Gradient fill belongs to captions and text graphics.');
  if (!Array.isArray(gradient.colors) || gradient.colors.length < 2 || gradient.colors.length > 5 || gradient.colors.some(color => typeof color !== 'string' || !hex.test(color))) throw new Error('Choose two to five hex gradient colors.');
  if (!Number.isFinite(gradient.angle) || gradient.angle < 0 || gradient.angle > 360) throw new Error('Gradient angle must be between 0 and 360 degrees.');
  if (gradient.offset !== undefined && !Number.isFinite(gradient.offset)) throw new Error('Gradient timing offset must be finite.');
  const animation = gradient.animation;
  if (animation && (!Number.isFinite(animation.duration) || animation.duration < .2 || animation.duration > 60 || !['forward', 'reverse'].includes(animation.direction) || typeof animation.loop !== 'boolean')) throw new Error('Gradient movement needs a duration from 0.2 to 60 seconds, a direction and a loop setting.');
}

/** Shared easing and the clip clock drive the fill; no CSS animation or wall clock. */
export function textGradientFill(gradient: TextGradient | undefined, localTime = 0, shadow = 'none') {
  if (!gradient) return {};
  let position = 0;
  if (gradient.animation) {
    const { duration, direction, loop } = gradient.animation;
    const elapsed = Math.max(0, localTime + (gradient.offset ?? 0)) / duration;
    const phase = loop ? elapsed % 2 : Math.min(1, elapsed);
    position = motionEase(phase <= 1 ? phase : 2 - phase, 'ease-in-out');
    if (direction === 'reverse') position = 1 - position;
  }
  return {
    backgroundImage: `linear-gradient(${gradient.angle}deg,${gradient.colors.join(',')})`,
    backgroundSize: gradient.animation ? '200% 200%' : '100% 100%',
    backgroundPosition: `${position * 100}% ${position * 100}%`,
    backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent',
    // Text shadows paint over transparent glyph fill. Filtering the completed
    // gradient keeps the shadow behind the colored letters instead.
    textShadow: 'none', ...(shadow && shadow !== 'none' ? { filter: shadow.split(',').map(value => `drop-shadow(${value.trim()})`).join(' ') } : {}),
  } as const;
}

export function textGradientTimingPatch(clip: { textGradient?: TextGradient }, delta = 0) {
  return clip.textGradient ? { textGradient: { ...clip.textGradient, offset: (clip.textGradient.offset ?? 0) + delta } } : {};
}

/** Updating fill never replaces text movement, word timing, or its saved solid color. */
export function textGradientPatch(clip: { kind: string; textGradient?: TextGradient }, changes: TextGradientChanges) {
  if (!['caption', 'graphic'].includes(clip.kind)) throw new Error('Choose a caption or text graphic.');
  if (!changes.enabled) return { textGradient: undefined };
  const previous = clip.textGradient ?? DEFAULT_TEXT_GRADIENT;
  const textGradient: TextGradient = { ...previous, ...(changes.colors ? { colors: [...changes.colors] } : {}), ...(changes.angle !== undefined ? { angle: changes.angle } : {}) };
  if (changes.animation) {
    const { enabled, ...settings } = changes.animation;
    textGradient.animation = enabled ? { duration: 3, direction: 'forward', loop: true, ...previous.animation, ...settings } : undefined;
    textGradient.offset = 0;
  }
  validateTextGradient({ kind: clip.kind, textGradient });
  return { textGradient };
}
