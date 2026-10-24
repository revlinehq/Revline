import { EFFECT_CATALOG, type EffectPreset } from './clip-effects';
import type { VisualEffects } from './visual-effects';
type EffectIconName = Exclude<keyof VisualEffects, 'frameCorners' | 'lightSweep'> | Exclude<EffectPreset, 'none' | 'zoom-blur'> | 'speed-up';

export const EFFECT_LIBRARY_CATEGORIES = [{ id: 'motion', label: 'Motion' }, { id: 'color', label: 'Color' }, { id: 'texture', label: 'Texture' }] as const;
export type EffectLibraryCategory = typeof EFFECT_LIBRARY_CATEGORIES[number]['id'];
export type EffectLibraryEntry = { id: EffectIconName; label: string; description: string; category: EffectLibraryCategory; visual?: Exclude<keyof VisualEffects, 'lightSweep'>; preset?: EffectPreset; action?: 'speed' };

/** One catalog drives categories, search, icons, click actions, and drag payloads.
 * Retired effects (zoom blur, shake, pop, flash, cinema bars, dither, neon edges,
 * light leak, transitions) stay renderable in saved projects but are not offered. */
export const EFFECT_LIBRARY_CATALOG: readonly EffectLibraryEntry[] = [
  { id: 'quick-zoom-in', label: 'Zoom', description: 'Choose In, Out or Punch. Edit zoom strength, speed and center, or the Punch preset attack and return time.', category: 'motion', preset: 'quick-zoom-in' },
  { id: 'speed-up', label: 'Change speed', description: 'Adjust video or audio playback', category: 'motion', action: 'speed' },
  { id: 'solid-color', label: 'Solid color', description: 'A color frame or adjustable rectangle', category: 'color', preset: 'solid-color' },
  { id: 'colorGrade', label: 'Color & light', description: 'Adjust the selected footage', category: 'color', visual: 'colorGrade' },
  { id: 'invert', label: 'Invert colors', description: 'Turn colors into a negative', category: 'color', visual: 'invert' },
  { id: 'frameDistortion', label: 'Frame distortion', description: 'Curve the whole frame and its outer edges inward or outward, with transparent space around the bent silhouette. Advanced perspective and skew remain adjustable.', category: 'motion', visual: 'frameDistortion' },
  { id: 'lensDistortion', label: 'Lens distortion', description: 'A curved wide-angle lens bend with adjustable strength, optical center and color fringing. Fills the frame without adding a border.', category: 'motion', visual: 'lensDistortion' },
  { id: 'directionalBlur', label: 'Directional blur', description: 'A smooth streak blur along an editable angle, with adjustable strength. Keeps the original source and timing.', category: 'motion', visual: 'directionalBlur' },
  { id: 'turbulentDisplace', label: 'Turbulent displacement', description: 'Organic flowing distortion with adjustable strength, scale and speed. Procedural and deterministic at every timeline frame.', category: 'motion', visual: 'turbulentDisplace' },
  { id: 'filmOverlay', label: 'Film overlay', description: 'Animated film grain, dust and scratches, with adjustable vignette, flicker and warmth. Procedural, with no overlay download required.', category: 'texture', visual: 'filmOverlay' },
  { id: 'vhs', label: 'VHS overlay', description: 'Analog scanlines, tape noise, subtle RGB bleed and rolling tracking distortion. Adjustable strength, components and speed; no overlay download.', category: 'texture', visual: 'vhs' },
  { id: 'glitch', label: 'Digital glitch', description: 'Distort the selected footage', category: 'texture', visual: 'glitch' },
];
