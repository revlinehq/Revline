import { EFFECT_CATALOG, type EffectPreset } from './clip-effects';
import type { VisualEffects } from './visual-effects';
type EffectIconName = keyof VisualEffects | Exclude<EffectPreset, 'none' | 'zoom-blur'> | 'speed-up';

export const EFFECT_LIBRARY_CATEGORIES = [{ id: 'motion', label: 'Motion' }, { id: 'color', label: 'Color' }, { id: 'texture', label: 'Texture' }, { id: 'transitions', label: 'Transitions' }] as const;
export type EffectLibraryCategory = typeof EFFECT_LIBRARY_CATEGORIES[number]['id'];
export type EffectLibraryEntry = { id: EffectIconName; label: string; description: string; category: EffectLibraryCategory; visual?: keyof VisualEffects; preset?: EffectPreset; action?: 'speed' };

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
  { id: 'frameDistortion', label: 'Frame distortion', description: 'Tilt the picture into perspective or skew it into a parallelogram. Keeps edges straight and unused corners transparent for layering.', category: 'motion', visual: 'frameDistortion' },
  { id: 'lensDistortion', label: 'Lens distortion', description: 'A curved wide-angle lens bend with adjustable strength, optical center and color fringing. Fills the frame without adding a border.', category: 'motion', visual: 'lensDistortion' },
  { id: 'filmOverlay', label: 'Film overlay', description: 'Animated film grain, dust and scratches, with adjustable vignette, flicker and warmth. Procedural, with no overlay download required.', category: 'texture', visual: 'filmOverlay' },
  { id: 'glitch', label: 'Digital glitch', description: 'Distort the selected footage', category: 'texture', visual: 'glitch' },
  { id: 'crossfade', label: 'Crossfade', description: 'Blend two neighboring clips at their cut', category: 'transitions', preset: 'crossfade' },
  { id: 'spin-zoom', label: 'Spin zoom', description: 'Rotate and zoom between neighboring clips', category: 'transitions', preset: 'spin-zoom' },
  { id: 'blur-dissolve', label: 'Blur dissolve', description: 'Soften and dissolve between neighboring clips', category: 'transitions', preset: 'blur-dissolve' },
];
