type FocusPoint = { time: number; x: number; y: number };

/**
 * The focus point at a source time: linear between the surrounding samples, held at the first or last sample
 * outside them. Samples are in increasing source time; with none there is no focus.
 */
export function focusAt(samples: readonly FocusPoint[], time: number): FocusPoint | undefined {
  if (!samples.length) return undefined;
  const after = samples.findIndex(sample => sample.time >= time);
  if (after <= 0) return { ...(after === -1 ? samples[samples.length - 1] : samples[0]), time };
  const previous = samples[after - 1], next = samples[after];
  const mix = (time - previous.time) / (next.time - previous.time);
  return { time, x: previous.x + (next.x - previous.x) * mix, y: previous.y + (next.y - previous.y) * mix };
}
