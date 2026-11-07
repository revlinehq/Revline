// Impact math shared by films (hit() in scene-motion) and footage: a decaying shake, a punch-in and a one-frame
// flash, as pure functions of their settings and a frame index. No DOM, no GSAP, no clock: the same settings and
// frame give the same values wherever they are drawn, so a film hit and a footage hit look identical.
//
// Frame 0 is the hit frame (the hardest one); the shake and punch rest exactly from frame `frames` on, and every
// value is rest before frame 0. A frame index may be fractional (a renderer between frames); whole frames are what
// preview and export sample.

export type ImpactAxis = 'x' | 'y' | 'both';
export type ImpactSettings = {
  /** 0..1: 1 moves the picture 3.5% of its shorter side. */
  intensity: number;
  /** Frames until rest, 3..30. */
  frames: number;
  axis: ImpactAxis;
  /** Extra scale at the hit, 0..0.25, settling with the shake. */
  punch: number;
  /** Any integer: different hits shake differently, the same seed always the same way. */
  seed: number;
  /** Adds just enough scale that the shake never shows the picture's edge (for a whole frame or shot). */
  cover: boolean;
};
/** One frame of an impact: offsets as fractions of the picture's shorter side, rotation in degrees, scale factor. */
export type ImpactFrame = { x: number; y: number; rotate: number; scale: number };

export const IMPACT_DEFAULTS: ImpactSettings = { intensity: .5, frames: 10, axis: 'both', punch: .04, seed: 1, cover: false };
export const IMPACT_RANGES = { intensity: [0, 1], frames: [3, 30], punch: [0, .25] } as const;
export const FLASH_DEFAULTS = { opacity: .9, color: '#ffffff' } as const;
/** Peak offset, as a fraction of the shorter side, at intensity 1. */
const TRAVEL = .035;
const REST: ImpactFrame = { x: 0, y: 0, rotate: 0, scale: 1 };

/** A deterministic 0..1 value for a seed. */
export function seeded(seed: number) {
  let state = (Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9) >>> 0;
  state = Math.imul(state ^ (state >>> 16), 2246822507) >>> 0;
  state = Math.imul(state ^ (state >>> 13), 3266489909) >>> 0;
  return ((state ^ (state >>> 16)) >>> 0) / 4294967296;
}

/** Settings with defaults filled in and numbers clamped to their ranges (frames to whole frames). */
export function impactSettings(input: Partial<ImpactSettings> = {}): ImpactSettings {
  const clamp = (value: number | undefined, fallback: number, [min, max]: readonly [number, number]) => value === undefined || !Number.isFinite(value) ? fallback : Math.min(max, Math.max(min, value));
  return {
    intensity: clamp(input.intensity, IMPACT_DEFAULTS.intensity, IMPACT_RANGES.intensity),
    frames: Math.round(clamp(input.frames, IMPACT_DEFAULTS.frames, IMPACT_RANGES.frames)),
    axis: input.axis === 'x' || input.axis === 'y' ? input.axis : 'both',
    punch: clamp(input.punch, IMPACT_DEFAULTS.punch, IMPACT_RANGES.punch),
    seed: Number.isFinite(input.seed) ? Math.trunc(input.seed!) : IMPACT_DEFAULTS.seed,
    cover: input.cover ?? IMPACT_DEFAULTS.cover,
  };
}

/** The shake, punch and cover at `frame`: hardest on frame 0, decaying to exact rest at `frames`. */
export function impactAt(settings: ImpactSettings, frame: number): ImpactFrame {
  const { intensity, frames, axis, punch, seed, cover } = settings;
  if (!(frame >= 0) || frame >= frames) return REST;
  const u = frame / frames, shake = (1 - u) ** 2, settle = (1 - u) ** 3, amplitude = intensity * TRAVEL;
  // Two cosines per axis (cosine: displaced on the hit frame itself), phases from the seed.
  const cycles = frames / 2.4, phase = seeded(seed) * Math.PI * 2, wobble = seeded(seed + 101) * Math.PI * 2;
  const wave = (offset: number, shift: number) => Math.cos(2 * Math.PI * cycles * u + shift) * .75 + Math.cos(2 * Math.PI * cycles * 1.7 * u + offset) * .25;
  return {
    x: axis === 'y' ? 0 : amplitude * shake * wave(phase, 0),
    y: axis === 'x' ? 0 : amplitude * (axis === 'both' ? .7 : 1) * shake * wave(wobble, Math.PI / 2.6),
    rotate: axis === 'both' ? intensity * 1.2 * shake * wave(phase + 1, 1.1) : 0,
    scale: 1 + punch * settle + (cover ? 2 * amplitude * shake : 0),
  };
}

/** A one-frame flash: `opacity` within half a frame of frame 0 (both ends open), nothing anywhere else. */
export const flashAt = (frame: number, opacity: number = FLASH_DEFAULTS.opacity) => frame > -.5 && frame < .5 ? opacity : 0;
