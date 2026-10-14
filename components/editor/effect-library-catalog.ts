import { EFFECT_CATALOG, type EffectPreset } from '@/lib/editor/clip-effects';
import type { VisualEffects } from '@/lib/editor/visual-effects';
import type { EffectIconName } from './effect-icon';

export const EFFECT_LIBRARY_CATEGORIES = [{ id: 'motion', label: 'Motion' }, { id: 'color', label: 'Color' }, { id: 'texture', label: 'Texture' }, { id: 'transitions', label: 'Transitions' }] as const;
export type EffectLibraryCategory = typeof EFFECT_LIBRARY_CATEGORIES[number]['id'];
export type EffectLibraryEntry = { id: EffectIconName; label: string; description: string; category: EffectLibraryCategory; visual?: keyof VisualEffects; preset?: EffectPreset; action?: 'speed' };

/** One catalog drives categories, search, icons, click actions, and drag payloads. */
export const EFFECT_LIBRARY_CATALOG: readonly EffectLibraryEntry[] = [
  { id: 'quick-zoom-in', label: 'Zoom in', description: 'Push toward your subject', category: 'motion', preset: 'quick-zoom-in' },
  { id: 'quick-zoom-out', label: 'Zoom out', description: 'Pull back to reveal the scene', category: 'motion', preset: 'quick-zoom-out' },
  { id: 'zoomBlur', label: 'Zoom blur', description: 'A timed blur pulse above your footage', category: 'motion', preset: 'zoom-blur' },
  ...(['punch', 'shake', 'pop', 'fade', 'flash'] as const).map(preset => ({ id: preset, label: EFFECT_CATALOG[preset].label, description: 'Add at the playhead', category: 'motion' as const, preset })),
  { id: 'cinematic-bars', label: 'Cinema bars', description: 'Black bars slide in and out', category: 'motion', preset: 'cinematic-bars' },
  { id: 'speed-up', label: 'Change speed', description: 'Adjust video or audio playback', category: 'motion', action: 'speed' },
  { id: 'solid-color', label: 'Solid color', description: 'A color frame or adjustable rectangle', category: 'color', preset: 'solid-color' },
  { id: 'colorGrade', label: 'Color & light', description: 'Adjust the selected footage', category: 'color', visual: 'colorGrade' },
  { id: 'invert', label: 'Invert colors', description: 'Turn colors into a negative', category: 'color', visual: 'invert' },
  { id: 'dither', label: 'Dither', description: 'Ordered dots and a reduced color palette', category: 'texture', visual: 'dither' },
  { id: 'glitch', label: 'Digital glitch', description: 'Distort the selected footage', category: 'texture', visual: 'glitch' },
];
