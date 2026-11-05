import type { FocusSample } from '../editor/tracking';
import { focusAt } from '../editor/focus-path';

/** Interpolate measured face centers only inside the sampled source range. */
export function trackedSubjectAt(samples: readonly FocusSample[], time: number): { x: number; y: number } | undefined {
  if (!samples.length || !Number.isFinite(time) || time < samples[0].time || time > samples[samples.length - 1].time + .5) return;
  return focusAt(samples, time);
}
