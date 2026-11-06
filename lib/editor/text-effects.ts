import { motionPreset } from './clip-effects';
import type { Clip } from './types';
import { DEFAULT_TEXT_HIGHLIGHT, REMOTION_TEXT_LABELS, REMOTION_TEXT_DESCRIPTIONS, REMOTION_TEXT_PRESETS, VFX_TEXT_APPEARANCE, type RemotionTextPreset } from './remotion-text';
import { resolvedTextAppearance } from './text-style';

export const TEXT_EFFECT_PRESETS = ['none', 'fade', 'rise', 'pop'] as const;
export type TextEffectPreset = typeof TEXT_EFFECT_PRESETS[number];
export const TEXT_EFFECT_LABELS: Record<TextEffectPreset, string> = { none: 'None', fade: 'Fade', rise: 'Rise', pop: 'Pop in' };
export const TEXT_ANIMATION_PRESETS = [...TEXT_EFFECT_PRESETS, ...REMOTION_TEXT_PRESETS] as const;
export type TextAnimationPreset = typeof TEXT_ANIMATION_PRESETS[number];
export const TEXT_ANIMATION_LABELS = { ...TEXT_EFFECT_LABELS, ...REMOTION_TEXT_LABELS };

export const TEXT_ANIMATION_DESCRIPTIONS:Record<TextAnimationPreset,string> = {
none:"Show static text without entrance/exit or per-word animation.",fade:"Fade the complete text in and out while holding it during the middle of its clip.",rise:"Fade and lift the whole text upward into place, retaining its selected appearance.",pop:"Pop the whole text in from reduced scale with opacity and a small scale overshoot; settles without changing the selected look.",
...REMOTION_TEXT_DESCRIPTIONS
};

export function textEffectPatch(clip: Clip, preset: TextEffectPreset): Partial<Clip> {
  if (clip.kind !== 'caption' && clip.kind !== 'graphic') throw new Error('Select a text clip to apply a text effect.');
  return { ...(preset === 'pop' ? motionPreset(clip, 'pop') : { animation: preset, motion: [], motionOffset: 0, textAnimationTiming: undefined }), textAnimationTiming: undefined };
}

export function textTemplatePatch(clip: Clip, preset: RemotionTextPreset): Partial<Clip> {
  if (clip.kind !== 'caption' && clip.kind !== 'graphic') throw new Error('Select a text clip to apply a text template.');
  const highlightColor = clip.textTemplate?.highlightColor ?? (clip.textTemplate ? VFX_TEXT_APPEARANCE[clip.textTemplate.preset]?.highlightColor : undefined) ?? DEFAULT_TEXT_HIGHLIGHT;
  const speech=preset==='karaoke'&&clip.textTemplate?.wordTimings?clip.textTemplate:undefined;
  const clock=clip.textTemplate?.preset===preset?clip.textTemplate:speech;
  const controls = clip.textTemplate ? Object.fromEntries((['strength','revealDuration','stagger'] as const).filter(key=>clip.textTemplate![key]!==undefined).map(key=>[key,clip.textTemplate![key]])) : {};
  return { textStyle: resolvedTextAppearance(clip), textAnimationTiming: undefined, textTemplate: { preset, duration: clock?.duration??clip.duration, offset: clock?.offset??0, ...controls, ...(speech?{wordTimings:speech.wordTimings,...(speech.karaokeStyle?{karaokeStyle:speech.karaokeStyle}:{})}:{}), ...(highlightColor ? { highlightColor } : {}) } };
}

/** One animation selection replaces motion, while words and appearance stay untouched. */
export function textAnimationPatch(clip: Clip, preset: TextAnimationPreset): Partial<Clip> {
  return REMOTION_TEXT_PRESETS.includes(preset as RemotionTextPreset)
    ? { ...textTemplatePatch(clip, preset as RemotionTextPreset), animation: 'none', motion: [], motionOffset: 0 }
    : { ...textEffectPatch(clip, preset as TextEffectPreset), textStyle: resolvedTextAppearance(clip), textTemplate: undefined };
}

export function selectedTextEffect(clip: Clip): TextEffectPreset | null {
  if (!clip.motion?.length) return clip.animation ?? 'none';
  return !clip.motionOffset && JSON.stringify(clip.motion) === JSON.stringify(motionPreset(clip, 'pop').motion) ? 'pop' : null;
}
