import { motionPreset } from './clip-effects';
import type { Clip } from './types';
import { DEFAULT_TEXT_HIGHLIGHT, REMOTION_TEXT_LABELS, REMOTION_TEXT_PRESETS, VFX_TEXT_APPEARANCE, type RemotionTextPreset } from './remotion-text';
import { resolvedTextAppearance } from './text-style';

export const TEXT_EFFECT_PRESETS = ['none', 'fade', 'rise', 'pop'] as const;
export type TextEffectPreset = typeof TEXT_EFFECT_PRESETS[number];
export const TEXT_EFFECT_LABELS: Record<TextEffectPreset, string> = { none: 'None', fade: 'Fade', rise: 'Rise', pop: 'Pop in' };
export const TEXT_ANIMATION_PRESETS = [...TEXT_EFFECT_PRESETS, ...REMOTION_TEXT_PRESETS] as const;
export type TextAnimationPreset = typeof TEXT_ANIMATION_PRESETS[number];
export const TEXT_ANIMATION_LABELS = { ...TEXT_EFFECT_LABELS, ...REMOTION_TEXT_LABELS };

export function textEffectPatch(clip: Clip, preset: TextEffectPreset): Partial<Clip> {
  if (clip.kind !== 'caption' && clip.kind !== 'graphic') throw new Error('Select a text clip to apply a text effect.');
  return { ...(preset === 'pop' ? motionPreset(clip, 'pop') : { animation: preset, motion: [], motionOffset: 0, textAnimationTiming: undefined }), textAnimationTiming: undefined };
}

export function textTemplatePatch(clip: Clip, preset: RemotionTextPreset): Partial<Clip> {
  if (clip.kind !== 'caption' && clip.kind !== 'graphic') throw new Error('Select a text clip to apply a text template.');
  const highlightColor = clip.textTemplate?.highlightColor ?? (clip.textTemplate ? VFX_TEXT_APPEARANCE[clip.textTemplate.preset]?.highlightColor : undefined) ?? DEFAULT_TEXT_HIGHLIGHT;
  return { textStyle: resolvedTextAppearance(clip), textAnimationTiming: undefined, textTemplate: { preset, duration: clip.duration, offset: 0, ...(highlightColor ? { highlightColor } : {}) } };
}

/** One animation selection replaces motion, while words and appearance stay untouched. */
export function textAnimationPatch(clip: Clip, preset: TextAnimationPreset): Partial<Clip> {
  return REMOTION_TEXT_PRESETS.includes(preset as RemotionTextPreset)
    ? { ...textTemplatePatch(clip, preset as RemotionTextPreset), animation: 'none', motion: [], motionOffset: 0 }
    : { ...textEffectPatch(clip, preset as TextEffectPreset), textStyle: resolvedTextAppearance(clip), textTemplate: undefined };
}

export function selectedTextAnimation(clip: Clip): TextAnimationPreset | null {
  return clip.textTemplate?.preset ?? selectedTextEffect(clip);
}

export function selectedTextEffect(clip: Clip): TextEffectPreset | null {
  if (!clip.motion?.length) return clip.animation ?? 'none';
  return !clip.motionOffset && JSON.stringify(clip.motion) === JSON.stringify(motionPreset(clip, 'pop').motion) ? 'pop' : null;
}
