import { motionEase, isMotionEasing, type MotionEasing } from './motion-path';

/**
 * A speed ramp: playback rate over clip-local timeline seconds, as linear breakpoints. Linear segments
 * integrate exactly, so Revline's source-time math matches the playback engine's `rate` lane, which
 * renders it in preview and export. Curves are baked into dense points, like motion paths.
 */
export type RampPoint = { t: number; v: number };
export type RampAnchor = { x: number; rate: number; easing?: MotionEasing };
export const MIN_RAMP_RATE = .1, MAX_RAMP_RATE = 10, MAX_RAMP_POINTS = 256;

/** CapCut-style curves over the clip's length (x 0..1), matching the playback engine's presets. */
export const SPEED_RAMP_PRESETS = {
  montage: [[0, .9], [.15, .3], [.5, 2.5], [.85, .3], [1, .9]],
  hero: [[0, 1], [.25, 1.6], [.5, .25], [.75, 1.6], [1, 1]],
  bullet: [[0, 3], [.4, 3], [.5, .15], [.6, 3], [1, 3]],
  'flash-in': [[0, .3], [.6, .6], [1, 5]],
  'flash-out': [[0, 5], [.4, .6], [1, .3]],
  'ramp-in': [[0, .5], [1, 1]],
  'ramp-out': [[0, 1], [1, .5]],
  'slowmo-middle': [[0, 1], [.35, .35], [.65, .35], [1, 1]],
} as const satisfies Record<string, readonly (readonly [number, number])[]>;
export type SpeedRampPreset = keyof typeof SPEED_RAMP_PRESETS;
export const SPEED_RAMP_PRESET_IDS = Object.keys(SPEED_RAMP_PRESETS) as SpeedRampPreset[];

export function validateSpeedRamp(clip: { kind: string; duration: number; playbackRate?: number; speedRamp?: RampPoint[] }) {
  const points = clip.speedRamp;
  if (points === undefined) return;
  if (clip.kind !== 'video' && clip.kind !== 'audio') throw new Error('Speed ramps apply to video and audio clips.');
  if (clip.playbackRate !== undefined && clip.playbackRate !== 1) throw new Error('A speed ramp replaces the constant playback speed.');
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_RAMP_POINTS) throw new Error(`A speed ramp needs 2 to ${MAX_RAMP_POINTS} points.`);
  points.forEach((point, index) => {
    if (!Number.isFinite(point.t) || point.t < 0 || index > 0 && point.t <= points[index - 1].t) throw new Error('Speed ramp points need increasing, nonnegative times.');
    if (!Number.isFinite(point.v) || point.v < MIN_RAMP_RATE || point.v > MAX_RAMP_RATE) throw new Error(`Speed ramp rates must be between ${MIN_RAMP_RATE}× and ${MAX_RAMP_RATE}×.`);
  });
}

export function rampRateAt(points: RampPoint[], t: number) {
  if (t <= points[0].t) return points[0].v;
  const after = points.findIndex(point => point.t >= t);
  if (after === -1) return points[points.length - 1].v;
  const a = points[after - 1], b = points[after];
  return a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t);
}

/** Source seconds consumed from clip-local 0 to t: the exact integral of the linear rate. */
export function rampSpan(points: RampPoint[], t: number) {
  if (t <= 0) return t * points[0].v;
  let span = Math.min(t, points[0].t) * points[0].v;
  for (let index = 1; index < points.length && points[index - 1].t < t; index++) {
    const a = points[index - 1], b = points[index], end = Math.min(t, b.t);
    span += (end - a.t) * (a.v + rampRateAt(points, end)) / 2;
  }
  const last = points[points.length - 1];
  if (t > last.t) span += (t - last.t) * last.v;
  return span;
}

/** Inverse of rampSpan: the clip-local time at which `span` source seconds have played. */
export function rampTimeAtSpan(points: RampPoint[], span: number) {
  if (span <= 0) return span / points[0].v;
  let consumed = points[0].t * points[0].v;
  if (span <= consumed) return span / points[0].v;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index], length = b.t - a.t, segment = length * (a.v + b.v) / 2;
    if (span <= consumed + segment) {
      // Solve a.v·x + (b.v - a.v)/(2·length)·x² = remaining for x in [0, length].
      const remaining = span - consumed, k = (b.v - a.v) / (2 * length);
      const x = Math.abs(k) < 1e-12 ? remaining / a.v : (-a.v + Math.sqrt(a.v * a.v + 4 * k * remaining)) / (2 * k);
      return a.t + Math.min(length, Math.max(0, x));
    }
    consumed += segment;
  }
  const last = points[points.length - 1];
  return last.t + (span - consumed) / last.v;
}

/** The ramp seen from `delta` seconds into the clip (after a left trim or as the right half of a split). */
export function shiftSpeedRamp(points: RampPoint[], delta: number): RampPoint[] {
  const kept = points.filter(point => point.t > delta + 1e-9).map(point => ({ t: point.t - delta, v: point.v }));
  const shifted = [{ t: 0, v: rampRateAt(points, delta) }, ...kept];
  return shifted.length >= 2 ? shifted : [shifted[0], { t: 1, v: shifted[0].v }];
}

/** Bake normalized anchors (x 0..1 of the clip) into points over `duration`, curving eased segments. */
export function bakeSpeedRamp(anchors: RampAnchor[], duration: number): RampPoint[] {
  if (anchors.length < 2 || anchors.length > 12) throw new Error('Use 2 to 12 speed anchors.');
  anchors.forEach((anchor, index) => {
    if (!Number.isFinite(anchor.x) || anchor.x < 0 || anchor.x > 1 || index > 0 && anchor.x <= anchors[index - 1].x) throw new Error('Speed anchors need increasing x between 0 and 1 (fractions of the clip).');
    if (!Number.isFinite(anchor.rate) || anchor.rate < MIN_RAMP_RATE || anchor.rate > MAX_RAMP_RATE) throw new Error(`Speed anchors need a rate between ${MIN_RAMP_RATE}× and ${MAX_RAMP_RATE}×.`);
    if (anchor.easing !== undefined && !isMotionEasing(anchor.easing)) throw new Error('Choose a supported easing, or a cubic-bézier [x1, y1, x2, y2].');
  });
  const points: RampPoint[] = [{ t: anchors[0].x * duration, v: anchors[0].rate }];
  for (let index = 1; index < anchors.length; index++) {
    const from = anchors[index - 1], to = anchors[index], easing = to.easing ?? 'ease-in-out';
    const steps = easing === 'linear' || from.rate === to.rate ? 1 : 16;
    for (let step = 1; step <= steps; step++) {
      const value = from.rate + (to.rate - from.rate) * motionEase(step / steps, easing);
      points.push({ t: (from.x + (to.x - from.x) * step / steps) * duration, v: Math.min(MAX_RAMP_RATE, Math.max(MIN_RAMP_RATE, value)) });
    }
  }
  return points;
}

/** Normalized anchors for a preset. */
export const presetAnchors = (preset: SpeedRampPreset): RampAnchor[] => SPEED_RAMP_PRESETS[preset].map(([x, rate]) => ({ x, rate }));

/** Average rate of a ramp baked over a unit-length clip: a clip of source length L lasts L / mean. */
export const meanRampRate = (anchors: RampAnchor[]) => rampSpan(bakeSpeedRamp(anchors, 1), 1);
