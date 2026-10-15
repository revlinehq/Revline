import { EFFECT_CATALOG, type EffectPreset } from './clip-effects';
import type { VisualEffects } from './visual-effects';
type EffectIconName = Exclude<keyof VisualEffects, 'frameCorners' | 'lightSweep'> | Exclude<EffectPreset, 'none' | 'zoom-blur'> | 'speed-up';

export const EFFECT_LIBRARY_CATEGORIES = [{ id: 'motion', label: 'Motion' }, { id: 'color', label: 'Color' }, { id: 'texture', label: 'Texture' }, { id: 'transitions', label: 'Transitions' }] as const;
export type EffectLibraryCategory = typeof EFFECT_LIBRARY_CATEGORIES[number]['id'];
export type EffectLibraryEntry = { id: EffectIconName; label: string; description: string; category: EffectLibraryCategory; visual?: Exclude<keyof VisualEffects, 'lightSweep'>; preset?: EffectPreset; action?: 'speed' };

/** One catalog drives categories, search, icons, click actions, and drag payloads. */
export const EFFECT_LIBRARY_CATALOG: readonly EffectLibraryEntry[] = [
  { id: 'quick-zoom-in', label: 'Zoom', description: 'Zoom in or out with editable amount, speed and center', category: 'motion', preset: 'quick-zoom-in' },
  { id: 'zoomBlur', label: 'Zoom blur', description: 'A timed blur pulse above your footage', category: 'motion', preset: 'zoom-blur' },
  ...(['punch', 'shake', 'pop', 'flash'] as const).map(preset => ({ id: preset, label: EFFECT_CATALOG[preset].label, description: EFFECT_CATALOG[preset].description, category: 'motion' as const, preset })),
  { id: 'cinematic-bars', label: 'Cinema bars', description: 'Black bars slide in and out', category: 'motion', preset: 'cinematic-bars' },
  { id: 'speed-up', label: 'Change speed', description: 'Adjust video or audio playback', category: 'motion', action: 'speed' },
  { id: 'solid-color', label: 'Solid color', description: 'A color frame or adjustable rectangle', category: 'color', preset: 'solid-color' },
  { id: 'colorGrade', label: 'Color & light', description: 'Adjust the selected footage', category: 'color', visual: 'colorGrade' },
  { id: 'invert', label: 'Invert colors', description: 'Turn colors into a negative', category: 'color', visual: 'invert' },
  { id: 'dither', label: 'Dither', description: 'Ordered dots and a reduced color palette', category: 'texture', visual: 'dither' },
  { id: 'neonEdges', label: 'Neon edges', description: 'Luminous colored outlines over darkened footage, with adjustable strength, detail, edge threshold and glow. Keeps the original source, timing and sound.', category: 'texture', visual: 'neonEdges' },
  { id: 'frameDistortion', label: 'Frame distortion', description: 'Curve the whole frame and its outer edges inward or outward, with transparent space around the bent silhouette. Advanced perspective and skew remain adjustable.', category: 'motion', visual: 'frameDistortion' },
  { id: 'lensDistortion', label: 'Lens distortion', description: 'A curved wide-angle lens bend with adjustable strength, optical center and color fringing. Fills the frame without adding a border.', category: 'motion', visual: 'lensDistortion' },
  { id: 'directionalBlur', label: 'Directional blur', description: 'A smooth streak blur along an editable angle, with adjustable strength. Keeps the original source and timing.', category: 'motion', visual: 'directionalBlur' },
  { id: 'turbulentDisplace', label: 'Turbulent displacement', description: 'Organic flowing distortion with adjustable strength, scale and speed. Procedural and deterministic at every timeline frame.', category: 'motion', visual: 'turbulentDisplace' },
  { id: 'filmOverlay', label: 'Film overlay', description: 'Animated film grain, dust and scratches, with adjustable vignette, flicker and warmth. Procedural, with no overlay download required.', category: 'texture', visual: 'filmOverlay' },
  { id: 'vhs', label: 'VHS overlay', description: 'Analog scanlines, tape noise, subtle RGB bleed and rolling tracking distortion. Adjustable strength, components and speed; no overlay download.', category: 'texture', visual: 'vhs' },
  { id: 'lightLeak', label: 'Light leak', description: 'A soft colored exposure glow at the frame edge. Adjust color, edge position, spread, strength and motion speed.', category: 'texture', visual: 'lightLeak' },
  { id: 'glitch', label: 'Digital glitch', description: 'Distort the selected footage', category: 'texture', visual: 'glitch' },
  { id: 'crossfade', label: 'Crossfade', description: 'Blend two neighboring clips at their cut', category: 'transitions', preset: 'crossfade' },
  { id: 'spin-zoom', label: 'Spin zoom', description: 'Rotate and zoom between neighboring clips', category: 'transitions', preset: 'spin-zoom' },
  { id: 'blur-dissolve', label: 'Blur dissolve', description: 'Soften and dissolve between neighboring clips', category: 'transitions', preset: 'blur-dissolve' },
  { id: 'gradient-wipe', label: 'Gradient wipe', description: 'Reveal the next clip across an editable soft directional edge', category: 'transitions', preset: 'gradient-wipe' },
  { id: 'iris-wipe', label: 'Iris wipe', description: 'Open a soft circular or elliptical window into the next clip', category: 'transitions', preset: 'iris-wipe' },
];
