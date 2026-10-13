import type { Clip } from './types';

export type ColorGrade = { enabled: boolean; exposure: number; contrast: number; saturation: number; temperature: number; tint: number; vibrance: number };
export type ZoomBlur = { enabled: boolean; amount: number; centerX: number; centerY: number };
export type Glitch = { enabled: boolean; intensity: number; blockSize: number; rgbSplit: number };
export type VisualEffects = { colorGrade?: ColorGrade; zoomBlur?: ZoomBlur; glitch?: Glitch };
export type VisualEffectsPatch = { [K in keyof VisualEffects]?: Partial<NonNullable<VisualEffects[K]>> };

export const DEFAULT_COLOR_GRADE: Readonly<ColorGrade> = Object.freeze({ enabled: false, exposure: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0, vibrance: 0 });
export const DEFAULT_ZOOM_BLUR: Readonly<ZoomBlur> = Object.freeze({ enabled: false, amount: .15, centerX: .5, centerY: .5 });
/** Pixel values are measured at 1080 output height and scale with rendering resolution. */
export const DEFAULT_GLITCH: Readonly<Glitch> = Object.freeze({ enabled: false, intensity: .25, blockSize: 32, rgbSplit: 8 });
export const VISUAL_EFFECT_LIMITS = {
  colorGrade: { exposure: [-2, 2], contrast: [0, 2], saturation: [0, 2], temperature: [-100, 100], tint: [-100, 100], vibrance: [-100, 100] },
  zoomBlur: { amount: [0, 1], centerX: [0, 1], centerY: [0, 1] },
  glitch: { intensity: [0, 1], blockSize: [1, 100], rgbSplit: [0, 50] },
} as const;

export function validateVisualEffects(clip: Pick<Clip, 'kind'> & VisualEffects) {
  for (const property of Object.keys(VISUAL_EFFECT_LIMITS) as (keyof VisualEffects)[]) {
    const settings = clip[property];
    if (settings === undefined) continue;
    if (clip.kind !== 'video' && clip.kind !== 'image') throw new Error('Color, zoom blur and glitch apply to video or image clips only.');
    if (!settings || typeof settings !== 'object' || typeof settings.enabled !== 'boolean') throw new Error(`Invalid ${property} settings.`);
    const limits = VISUAL_EFFECT_LIMITS[property] as Record<string, readonly [number, number]>;
    const values = settings as unknown as Record<string, unknown>;
    if (Object.keys(values).some(key => key !== 'enabled' && !(key in limits))) throw new Error(`Unknown ${property} control.`);
    for (const [key, [min, max]] of Object.entries(limits)) {
      const value = values[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${property}.${key} must be between ${min} and ${max}.`);
    }
  }
}

/** Merge only requested controls, preserving every other visual setting and all audio. */
export function visualEffectsPatch(clip: Pick<Clip, 'kind'> & VisualEffects, patch: VisualEffectsPatch): VisualEffects {
  const next: VisualEffects = {};
  if (patch.colorGrade !== undefined) next.colorGrade = { ...DEFAULT_COLOR_GRADE, ...clip.colorGrade, ...patch.colorGrade };
  if (patch.zoomBlur !== undefined) next.zoomBlur = { ...DEFAULT_ZOOM_BLUR, ...clip.zoomBlur, ...patch.zoomBlur };
  if (patch.glitch !== undefined) next.glitch = { ...DEFAULT_GLITCH, ...clip.glitch, ...patch.glitch };
  if (!Object.keys(next).length || Object.values(patch).every(value => !value || Object.keys(value).length === 0)) throw new Error('Specify at least one visual effect control.');
  validateVisualEffects({ kind: clip.kind, ...next });
  return next;
}
