import type { Clip } from './types';
import { DEFAULT_NEON_EDGES, NEON_EDGE_LIMITS, validateNeonEdges, type NeonEdges } from './neon-edges';
export type { NeonEdges } from './neon-edges';

export type ColorGrade = { enabled: boolean; exposure: number; contrast: number; saturation: number; temperature: number; tint: number; vibrance: number };
export type ZoomBlur = { enabled: boolean; amount: number; centerX: number; centerY: number };
export type Glitch = { enabled: boolean; intensity: number; blockSize: number; rgbSplit: number };
export type InvertColors = { enabled: boolean; amount: number };
export type Dither = { enabled: boolean; amount: number; levels: number; size: number; shadowColor?: string; highlightColor?: string };
export type FrameDistortion = { enabled: boolean; horizontal: number; vertical: number; skew: number; bend?: number };
export type FrameCorners = { enabled: boolean; amount: number };
export type SoftBlur = { enabled: boolean; amount: number };
export type LensDistortion = { enabled: boolean; amount: number; centerX: number; centerY: number; fringing: number };
export type FilmOverlay = { enabled: boolean; amount: number; grain: number; dust: number; scratches: number; vignette: number; flicker: number; warmth: number };
export type VisualEffects = { colorGrade?: ColorGrade; zoomBlur?: ZoomBlur; glitch?: Glitch; invert?: InvertColors; dither?: Dither; neonEdges?: NeonEdges; lensDistortion?: LensDistortion; filmOverlay?: FilmOverlay; softBlur?: SoftBlur; frameDistortion?: FrameDistortion; frameCorners?: FrameCorners };
export type VisualEffectsPatch = { [K in keyof VisualEffects]?: Partial<NonNullable<VisualEffects[K]>> };

export const DEFAULT_COLOR_GRADE: Readonly<ColorGrade> = Object.freeze({ enabled: false, exposure: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0, vibrance: 0 });
export const DEFAULT_INVERT: Readonly<InvertColors> = Object.freeze({ enabled: false, amount: 1 });
export const DEFAULT_DITHER: Readonly<Dither> = Object.freeze({ enabled: false, amount: 1, levels: 4, size: 2 });
export const DEFAULT_ZOOM_BLUR: Readonly<ZoomBlur> = Object.freeze({ enabled: false, amount: .15, centerX: .5, centerY: .5 });
/** Pixel values are measured at 1080 output height and scale with rendering resolution. */
export const DEFAULT_GLITCH: Readonly<Glitch> = Object.freeze({ enabled: false, intensity: .25, blockSize: 32, rgbSplit: 8 });
export const DEFAULT_FRAME_DISTORTION: Readonly<FrameDistortion> = Object.freeze({ enabled: false, horizontal: 0, vertical: 0, skew: 0, bend: .35 });
export const DEFAULT_FRAME_CORNERS: Readonly<FrameCorners> = Object.freeze({ enabled: false, amount: 0 });
export const DEFAULT_SOFT_BLUR: Readonly<SoftBlur> = Object.freeze({ enabled: false, amount: 0 });
export const DEFAULT_LENS_DISTORTION: Readonly<LensDistortion> = Object.freeze({ enabled: false, amount: .28, centerX: .5, centerY: .5, fringing: 2 });
export const DEFAULT_FILM_OVERLAY: Readonly<FilmOverlay> = Object.freeze({ enabled: false, amount: .65, grain: .35, dust: .18, scratches: .12, vignette: .25, flicker: .06, warmth: .15 });
/** Manual controls, drag/drop and agent tools share these defaults. */
export const VISUAL_EFFECT_DEFAULTS = Object.freeze({
  frameDistortion: DEFAULT_FRAME_DISTORTION, frameCorners: DEFAULT_FRAME_CORNERS, softBlur: DEFAULT_SOFT_BLUR, colorGrade: DEFAULT_COLOR_GRADE, zoomBlur: DEFAULT_ZOOM_BLUR, glitch: DEFAULT_GLITCH,
  invert: DEFAULT_INVERT, dither: DEFAULT_DITHER, neonEdges: DEFAULT_NEON_EDGES, lensDistortion: DEFAULT_LENS_DISTORTION, filmOverlay: DEFAULT_FILM_OVERLAY,
});
export const VISUAL_EFFECT_KEYS = Object.freeze(Object.keys(VISUAL_EFFECT_DEFAULTS) as (keyof VisualEffects)[]);
export const VISUAL_EFFECT_LIMITS = {
  frameDistortion: { horizontal: [-1, 1], vertical: [-1, 1], skew: [-1, 1], bend: [-1, 1] },
  frameCorners: { amount: [0, 1] },
  softBlur: { amount: [0, 40] },
  neonEdges: NEON_EDGE_LIMITS,
  colorGrade: { exposure: [-2, 2], contrast: [0, 2], saturation: [0, 2], temperature: [-100, 100], tint: [-100, 100], vibrance: [-100, 100] },
  zoomBlur: { amount: [0, 1], centerX: [0, 1], centerY: [0, 1] },
  invert: { amount: [0, 1] },
  dither: { amount: [0, 1], levels: [2, 16], size: [1, 8] },
  glitch: { intensity: [0, 1], blockSize: [1, 100], rgbSplit: [0, 50] },
  lensDistortion: { amount: [-.8, .8], centerX: [0, 1], centerY: [0, 1], fringing: [0, 10] },
  filmOverlay: { amount: [0, 1], grain: [0, 1], dust: [0, 1], scratches: [0, 1], vignette: [0, 1], flicker: [0, 1], warmth: [0, 1] },
} as const;

/** Preview, export and live updates use the same registered effect fields. */
export function visualEffectsOf(clip: VisualEffects): VisualEffects {
  return Object.fromEntries(VISUAL_EFFECT_KEYS.map(key => [key, clip[key]]));
}

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
      if (property === 'frameDistortion' && key === 'bend' && value === undefined) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${property}.${key} must be between ${min} and ${max}.`);
      if (property === 'dither' && (key === 'levels' || key === 'size') && !Number.isInteger(value)) throw new Error(`dither.${key} must be a whole number.`);
    }
  }
}

/** Merge only requested controls, preserving every other visual setting and all audio. */
export function visualEffectsPatch(clip: Pick<Clip, 'kind' | 'effectPreset'> & VisualEffects, patch: VisualEffectsPatch): VisualEffects {
  const next: VisualEffects = {};
  function merge<K extends keyof VisualEffects>(key: K) {
    next[key] = { ...VISUAL_EFFECT_DEFAULTS[key], ...clip[key], ...patch[key] } as NonNullable<VisualEffects[K]>;
    if (key === 'frameDistortion' && clip.frameDistortion && patch.frameDistortion?.bend === undefined) next.frameDistortion!.bend = clip.frameDistortion.bend ?? 0;
  }
  for (const key of VISUAL_EFFECT_KEYS) if (patch[key] !== undefined) merge(key);
  if (!Object.keys(next).length || Object.values(patch).every(value => !value || Object.keys(value).length === 0)) throw new Error('Specify at least one visual effect control.');
  validateVisualEffects({ kind: clip.kind, effectPreset:clip.effectPreset, ...next });
  return next;
}
