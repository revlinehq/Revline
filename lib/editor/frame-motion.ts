/**
 * Frame-based motion math for text templates and dev labs: pure functions of
 * the frame, so the same frame always gives the same value in preview and export.
 * Numerically matches the curves Revline's text animations were tuned with.
 */

export type EasingFunction = (t: number) => number;
type Extrapolate = 'clamp' | 'extend' | 'identity';
export type InterpolateOptions = { easing?: EasingFunction; extrapolateLeft?: Extrapolate; extrapolateRight?: Extrapolate };

export const Easing = {
  linear: (t: number) => t,
  quad: (t: number) => t * t,
  cubic: (t: number) => t * t * t,
  in: (easing: EasingFunction): EasingFunction => easing,
  out: (easing: EasingFunction): EasingFunction => t => 1 - easing(1 - t),
  inOut: (easing: EasingFunction): EasingFunction => t => t < .5 ? easing(t * 2) / 2 : 1 - easing((1 - t) * 2) / 2,
};

/** Piecewise mapping of `input` across a strictly increasing `inputRange`; extrapolation defaults to `extend`. */
export function interpolate(input: number, inputRange: readonly number[], outputRange: readonly number[], options: InterpolateOptions = {}): number {
  if (inputRange.length !== outputRange.length || inputRange.length < 1) throw new Error('inputRange and outputRange must have the same, non-zero length.');
  for (let i = 1; i < inputRange.length; i++) if (!(inputRange[i] > inputRange[i - 1])) throw new Error(`inputRange must be strictly increasing but got [${inputRange.join(',')}]`);
  if (inputRange.length === 1) return outputRange[0];
  let segment = 1;
  while (segment < inputRange.length - 1 && !(inputRange[segment] >= input)) segment++;
  const inputMin = inputRange[segment - 1], inputMax = inputRange[segment];
  const outputMin = outputRange[segment - 1], outputMax = outputRange[segment];
  const { easing = Easing.linear, extrapolateLeft = 'extend', extrapolateRight = 'extend' } = options;
  let value = input;
  if (value < inputMin) { if (extrapolateLeft === 'identity') return value; if (extrapolateLeft === 'clamp') value = inputMin; }
  if (value > inputMax) { if (extrapolateRight === 'identity') return value; if (extrapolateRight === 'clamp') value = inputMax; }
  if (outputMin === outputMax) return outputMin;
  return easing((value - inputMin) / (inputMax - inputMin)) * (outputMax - outputMin) + outputMin;
}

export type SpringConfig = { damping?: number; mass?: number; stiffness?: number };
type SpringState = { current: number; velocity: number; lastTimestamp: number };

/** One damped-oscillator step toward 1, in milliseconds; steps are capped at 64 ms. */
function advance(state: SpringState, now: number, damping: number, mass: number, stiffness: number): SpringState {
  const t = Math.min(now - state.lastTimestamp, 64) / 1000;
  const v0 = -state.velocity, x0 = 1 - state.current;
  const zeta = damping / (2 * Math.sqrt(stiffness * mass)), omega0 = Math.sqrt(stiffness / mass);
  if (zeta < 1) {
    const omega1 = omega0 * Math.sqrt(1 - zeta ** 2), sin1 = Math.sin(omega1 * t), cos1 = Math.cos(omega1 * t);
    const envelope = Math.exp(-zeta * omega0 * t);
    const fragment = envelope * (sin1 * ((v0 + zeta * omega0 * x0) / omega1) + x0 * cos1);
    return { current: 1 - fragment, velocity: zeta * omega0 * fragment - envelope * (cos1 * (v0 + zeta * omega0 * x0) - omega1 * x0 * sin1), lastTimestamp: now };
  }
  const envelope = Math.exp(-omega0 * t);
  return { current: 1 - envelope * (x0 + (v0 + omega0 * x0) * t), velocity: envelope * (v0 * (t * omega0 - 1) + t * x0 * omega0 * omega0), lastTimestamp: now };
}

/** Spring position at `frame`, stepped once per frame from rest at 0 toward 1. */
function springPosition(frame: number, fps: number, config: SpringConfig): number {
  const damping = config.damping ?? 10, mass = config.mass ?? 1, stiffness = config.stiffness ?? 100;
  if (damping <= 0) throw new Error('Spring damping must be greater than 0.');
  const clamped = Math.max(0, frame);
  let state: SpringState = { current: 0, velocity: 0, lastTimestamp: 0 };
  for (let f = 0; f <= Math.floor(clamped); f++) state = advance(state, f / fps * 1000, damping, mass, stiffness);
  if (clamped % 1 > 0) state = advance(state, clamped / fps * 1000, damping, mass, stiffness);
  return state.current;
}

const naturalDurations = new Map<string, number>();
/** Frames until the spring stays within 0.005 of rest for 20 consecutive frames; cached per fps and config. */
function naturalDuration(fps: number, config: SpringConfig): number {
  const key = `${fps}-${config.damping}-${config.mass}-${config.stiffness}`;
  const cached = naturalDurations.get(key);
  if (cached !== undefined) return cached;
  const settled = (frame: number) => Math.abs(springPosition(frame, fps, config) - 1) < .005;
  let frame = 0;
  while (!settled(frame)) frame++;
  let finished = frame;
  for (let i = 0; i < 20; i++) { frame++; if (!settled(frame)) { i = 0; finished = frame + 1; } }
  naturalDurations.set(key, finished);
  return finished;
}

/** Spring from 0 to 1. With `durationInFrames`, its natural settle time is stretched or squeezed to that many frames. */
export function spring({ frame, fps, config = {}, durationInFrames }: { frame: number; fps: number; config?: SpringConfig; durationInFrames?: number }): number {
  if (!Number.isFinite(frame) || !Number.isFinite(fps) || fps <= 0) throw new Error('spring() needs a finite frame and a positive fps.');
  if (durationInFrames === undefined) return springPosition(frame, fps, config);
  if (!(durationInFrames > 0)) throw new Error('Spring durationInFrames must be positive.');
  if (frame > durationInFrames) return 1;
  return springPosition(frame / (durationInFrames / naturalDuration(fps, config)), fps, config);
}
