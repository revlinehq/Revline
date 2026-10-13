import { motionPreset } from './clip-effects';
import type { Clip } from './types';
import type { RemotionTextPreset } from './remotion-text';

export const TEXT_EFFECT_PRESETS = ['none', 'fade', 'rise', 'pop'] as const;
export type TextEffectPreset = typeof TEXT_EFFECT_PRESETS[number];
export const TEXT_EFFECT_LABELS: Record<TextEffectPreset, string> = { none: 'None', fade: 'Fade', rise: 'Rise', pop: 'Pop in' };

export function textEffectPatch(clip: Clip, preset: TextEffectPreset): Partial<Clip> {
  if (clip.kind !== 'caption' && clip.kind !== 'graphic') throw new Error('Select a text clip to apply a text effect.');
  return { ...(preset === 'pop' ? motionPreset(clip, 'pop') : { animation: preset, motion: [], motionOffset: 0 }), textTemplate: undefined };
}

export function textTemplatePatch(clip: Clip, preset: RemotionTextPreset): Partial<Clip> {
  if (clip.kind !== 'caption' && clip.kind !== 'graphic') throw new Error('Select a text clip to apply a text template.');
  return { textTemplate: { preset, duration: clip.duration, offset: 0, ...(clip.textTemplate?.highlightColor ? { highlightColor: clip.textTemplate.highlightColor } : {}) }, animation: 'none', motion: [], motionOffset: 0 };
}

export function selectedTextEffect(clip: Clip): TextEffectPreset | null {
  if (clip.textTemplate) return null;
  if (!clip.motion?.length) return clip.animation ?? 'none';
  return !clip.motionOffset && JSON.stringify(clip.motion) === JSON.stringify(motionPreset(clip, 'pop').motion) ? 'pop' : null;
}
