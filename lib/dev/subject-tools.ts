import type { FocusSample } from '../editor/tracking';

/** Interpolate measured face centers only inside the sampled source range. */
export function trackedSubjectAt(samples: readonly FocusSample[], time: number): { x: number; y: number } | undefined {
  if (!samples.length || !Number.isFinite(time) || time < samples[0].time || time > samples[samples.length - 1].time + .5) return;
  const after = samples.findIndex(sample => sample.time >= time);
  if (after === -1) return samples[samples.length - 1];
  if (after === 0) return samples[0];
  const first = samples[after - 1], last = samples[after];
  const progress = (time - first.time) / (last.time - first.time);
  return { x: first.x + (last.x - first.x) * progress, y: first.y + (last.y - first.y) * progress };
}
