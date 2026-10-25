import { EFFECT_CATALOG, type EffectPreset } from './clip-effects';
import type { VisualEffects } from './visual-effects';
type EffectIconName = Exclude<keyof VisualEffects, 'frameCorners' | 'lightSweep'> | Exclude<EffectPreset, 'none' | 'zoom-blur'> | 'speed-up';

export const EFFECT_LIBRARY_CATEGORIES = [{ id: 'texture', label: 'Texture' }] as const;
export type EffectLibraryCategory = typeof EFFECT_LIBRARY_CATEGORIES[number]['id'];
export type EffectLibraryEntry = { id: EffectIconName; label: string; description: string; category: EffectLibraryCategory; visual?: Exclude<keyof VisualEffects, 'lightSweep'>; preset?: EffectPreset; action?: 'speed' };

/** One catalog drives categories, search, icons, click actions, and drag payloads.
 * Retired effects (zoom blur, shake, pop, flash, cinema bars, dither, neon edges,
 * light leak, transitions, the distortions and directional blur) and the Motion
 * and Color tabs stay renderable in saved projects but are not offered here. */
export const EFFECT_LIBRARY_CATALOG: readonly EffectLibraryEntry[] = [
  { id: 'filmOverlay', label: 'Film overlay', description: 'Animated film grain, dust and scratches, with adjustable vignette, flicker and warmth. Procedural, with no overlay download required.', category: 'texture', visual: 'filmOverlay' },
  { id: 'vhs', label: 'VHS overlay', description: 'Analog scanlines, tape noise, subtle RGB bleed and rolling tracking distortion. Adjustable strength, components and speed; no overlay download.', category: 'texture', visual: 'vhs' },
  { id: 'glitch', label: 'Digital glitch', description: 'Distort the selected footage', category: 'texture', visual: 'glitch' },
];
