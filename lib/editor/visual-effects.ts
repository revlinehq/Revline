import type { Clip } from './types';
import { DEFAULT_NEON_EDGES, NEON_EDGE_LIMITS, validateNeonEdges, type NeonEdges } from './neon-edges';
export type { NeonEdges } from './neon-edges';

export type ColorGrade = { enabled: boolean; exposure: number; contrast: number; saturation: number; temperature: number; tint: number; vibrance: number };
export type ZoomBlur = { enabled: boolean; amount: number; centerX: number; centerY: number };
export type Glitch = { enabled: boolean; intensity: number; blockSize: number; rgbSplit: number };
export type InvertColors = { enabled: boolean; amount: number };
export type Dither = { enabled: boolean; amount: number; levels: number; size: number; shadowColor?: string; highlightColor?: string };
export type VisualEffects = { colorGrade?: ColorGrade; zoomBlur?: ZoomBlur; glitch?: Glitch; invert?: InvertColors; dither?: Dither; neonEdges?: NeonEdges };
export type VisualEffectsPatch = { [K in keyof VisualEffects]?: Partial<NonNullable<VisualEffects[K]>> };

export const DEFAULT_COLOR_GRADE: Readonly<ColorGrade> = Object.freeze({ enabled: false, exposure: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0, vibrance: 0 });
export const DEFAULT_INVERT: Readonly<InvertColors> = Object.freeze({ enabled: false, amount: 1 });
export const DEFAULT_DITHER: Readonly<Dither> = Object.freeze({ enabled: false, amount: 1, levels: 4, size: 2 });
export const DEFAULT_ZOOM_BLUR: Readonly<ZoomBlur> = Object.freeze({ enabled: false, amount: .15, centerX: .5, centerY: .5 });
/** Pixel values are measured at 1080 output height and scale with rendering resolution. */
export const DEFAULT_GLITCH: Readonly<Glitch> = Object.freeze({ enabled: false, intensity: .25, blockSize: 32, rgbSplit: 8 });
export const VISUAL_EFFECT_LIMITS = {
  neonEdges: NEON_EDGE_LIMITS,
  colorGrade: { exposure: [-2, 2], contrast: [0, 2], saturation: [0, 2], temperature: [-100, 100], tint: [-100, 100], vibrance: [-100, 100] },
  zoomBlur: { amount: [0, 1], centerX: [0, 1], centerY: [0, 1] },
  invert: { amount: [0, 1] },
  dither: { amount: [0, 1], levels: [2, 16], size: [1, 8] },
  glitch: { intensity: [0, 1], blockSize: [1, 100], rgbSplit: [0, 50] },
} as const;

export function validateVisualEffects(clip: Pick<Clip, 'kind' | 'effectPreset'> & VisualEffects) {
  for (const property of Object.keys(VISUAL_EFFECT_LIMITS) as (keyof VisualEffects)[]) {
    const settings = clip[property];
    if (settings === undefined) continue;
    if (clip.kind !== 'video' && clip.kind !== 'image' && !(property === 'zoomBlur' && clip.kind === 'effect' && clip.effectPreset === 'zoom-blur')) throw new Error('Visual effects apply to video or image clips only.');
    if (!settings || typeof settings !== 'object' || typeof settings.enabled !== 'boolean') throw new Error(`Invalid ${property} settings.`);
    const limits = VISUAL_EFFECT_LIMITS[property] as Record<string, readonly [number, number]>;
    const values = settings as unknown as Record<string, unknown>;
    const colorKeys = property === 'dither' ? ['shadowColor', 'highlightColor'] : property === 'neonEdges' ? ['color'] : [];
    if (property === 'neonEdges') validateNeonEdges(settings as NeonEdges);
    if (Object.keys(values).some(key => key !== 'enabled' && !colorKeys.includes(key) && !(key in limits))) throw new Error(`Unknown ${property} control.`);
    for (const key of colorKeys) {
      if (values[key] !== undefined && (typeof values[key] !== 'string' || !/^#[\da-f]{6}$/i.test(values[key] as string))) throw new Error(`dither.${key} must be a six-digit hex color.`);
    }
    for (const [key, [min, max]] of Object.entries(limits)) {
      const value = values[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${property}.${key} must be between ${min} and ${max}.`);
      if (property === 'dither' && (key === 'levels' || key === 'size') && !Number.isInteger(value)) throw new Error(`dither.${key} must be a whole number.`);
    }
  }
}

/** Merge only requested controls, preserving every other visual setting and all audio. */
export function visualEffectsPatch(clip: Pick<Clip, 'kind' | 'effectPreset'> & VisualEffects, patch: VisualEffectsPatch): VisualEffects {
  const next: VisualEffects = {};
  if (patch.neonEdges !== undefined) next.neonEdges = { ...DEFAULT_NEON_EDGES, ...clip.neonEdges, ...patch.neonEdges };
  if (patch.colorGrade !== undefined) next.colorGrade = { ...DEFAULT_COLOR_GRADE, ...clip.colorGrade, ...patch.colorGrade };
  if (patch.zoomBlur !== undefined) next.zoomBlur = { ...DEFAULT_ZOOM_BLUR, ...clip.zoomBlur, ...patch.zoomBlur };
  if (patch.invert !== undefined) next.invert = { ...DEFAULT_INVERT, ...clip.invert, ...patch.invert };
  if (patch.glitch !== undefined) next.glitch = { ...DEFAULT_GLITCH, ...clip.glitch, ...patch.glitch };
  if (patch.dither !== undefined) next.dither = { ...DEFAULT_DITHER, ...clip.dither, ...patch.dither };
  if (!Object.keys(next).length || Object.values(patch).every(value => !value || Object.keys(value).length === 0)) throw new Error('Specify at least one visual effect control.');
  validateVisualEffects({ kind: clip.kind, effectPreset:clip.effectPreset, ...next });
  return next;
}
