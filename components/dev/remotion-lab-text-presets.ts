import { REMOTION_TEXT_LABELS, REMOTION_TEXT_PRESETS, type RemotionTextPreset } from '@/lib/editor/remotion-text';

export const LAB_EXTRA_TEXT_PRESETS = [
  'flip-words', 'line-wipe', 'elastic-wave', 'shutter-slice', 'iris-reveal',
  'liquid-stretch', 'orbit-assembly', 'stamp-impact', 'diagonal-stagger', 'soft-bloom',
] as const;
export type LabExtraTextPreset = typeof LAB_EXTRA_TEXT_PRESETS[number];
export type LabTextPreset = RemotionTextPreset | LabExtraTextPreset;
export const LAB_TEXT_PRESETS: readonly LabTextPreset[] = [...REMOTION_TEXT_PRESETS, ...LAB_EXTRA_TEXT_PRESETS];
export const LAB_TEXT_LABELS: Record<LabTextPreset, string> = {
  ...REMOTION_TEXT_LABELS,
  'flip-words': '3D word flip', 'line-wipe': 'Masked line wipe', 'elastic-wave': 'Elastic letter wave',
  'shutter-slice': 'Shutter slices', 'iris-reveal': 'Iris reveal', 'liquid-stretch': 'Liquid stretch',
  'orbit-assembly': 'Orbit assembly', 'stamp-impact': 'Stamp impact', 'diagonal-stagger': 'Diagonal cascade',
  'soft-bloom': 'Soft bloom',
};
export const LAB_TEXT_DESCRIPTIONS: Record<LabExtraTextPreset, string> = {
  'flip-words': 'Each word turns through a 3D hinge and settles into place.',
  'line-wipe': 'Lines rise through a clean mask, with an accent rule leading the reveal.',
  'elastic-wave': 'A spring entrance becomes a traveling wave across individual letters.',
  'shutter-slice': 'Four horizontal slices slide in from alternating sides and assemble each word.',
  'iris-reveal': 'A circular aperture opens across each word, accompanied by a restrained accent ring.',
  'liquid-stretch': 'Words stretch like soft material and spring back into their natural proportions.',
  'orbit-assembly': 'Individual letters travel along small orbital arcs and land on a steady baseline.',
  'stamp-impact': 'A heavy word stamp lands with a brief camera shake and an expanding impact ring.',
  'diagonal-stagger': 'Words sweep in along a diagonal and snap onto a clean baseline.',
  'soft-bloom': 'Letters emerge as a soft accent-colored bloom, then settle into crisp readable type.',
};
export function isLabExtraTextPreset(preset: LabTextPreset): preset is LabExtraTextPreset {
  return (LAB_EXTRA_TEXT_PRESETS as readonly string[]).includes(preset);
}
