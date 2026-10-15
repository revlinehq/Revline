import { REMOTION_TEXT_LABELS, REMOTION_TEXT_PRESETS, type RemotionTextPreset } from '@/lib/editor/remotion-text';

export const LAB_EXTRA_TEXT_PRESETS = [
  'flip-words', 'line-wipe', 'elastic-wave', 'rgb-split', 'type-trails',
  'liquid-stretch', 'blur-focus', 'stamp-impact', 'diagonal-stagger', 'character-scramble',
] as const;
export type LabExtraTextPreset = typeof LAB_EXTRA_TEXT_PRESETS[number];
export type LabTextPreset = RemotionTextPreset | LabExtraTextPreset;
export const LAB_TEXT_PRESETS: readonly LabTextPreset[] = [...REMOTION_TEXT_PRESETS, ...LAB_EXTRA_TEXT_PRESETS];
export const LAB_TEXT_LABELS: Record<LabTextPreset, string> = {
  ...REMOTION_TEXT_LABELS,
  'flip-words': '3D word flip', 'line-wipe': 'Masked line wipe', 'elastic-wave': 'Elastic letter wave',
  'rgb-split': 'Chromatic split', 'type-trails': 'Outline trails', 'liquid-stretch': 'Liquid stretch',
  'blur-focus': 'Cinematic focus', 'stamp-impact': 'Stamp impact', 'diagonal-stagger': 'Diagonal cascade',
  'character-scramble': 'Character scramble',
};
export const LAB_TEXT_DESCRIPTIONS: Record<LabExtraTextPreset, string> = {
  'flip-words': 'Each word turns through a 3D hinge and settles into place.',
  'line-wipe': 'Lines rise through a clean mask, with an accent rule leading the reveal.',
  'elastic-wave': 'A spring entrance becomes a traveling wave across individual letters.',
  'rgb-split': 'Two chromatic channels separate, slip and converge on crisp type.',
  'type-trails': 'Fine outline echoes follow the title, then catch up with the filled lettering.',
  'liquid-stretch': 'Words stretch like soft material and spring back into their natural proportions.',
  'blur-focus': 'Soft, widely spaced words pull into a sharp cinematic title.',
  'stamp-impact': 'A heavy word stamp lands with a brief camera shake and an expanding impact ring.',
  'diagonal-stagger': 'Words sweep in along a diagonal and snap onto a clean baseline.',
  'character-scramble': 'A deterministic character roll resolves from left to right into your exact text.',
};
export function isLabExtraTextPreset(preset: LabTextPreset): preset is LabExtraTextPreset {
  return (LAB_EXTRA_TEXT_PRESETS as readonly string[]).includes(preset);
}
