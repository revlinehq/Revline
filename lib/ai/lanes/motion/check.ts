import { timelineDuration } from '../../../editor/types';
import { currentEvidence, type LaneCheckContext } from '../types';
import { referenceMotionFailures } from '../recreate/motion';
export function check(context: LaneCheckContext): string[] {
  if (context.referenceMotion?.length) return referenceMotionFailures(context);
  const duration = timelineDuration(context.timeline);
  const ranges = currentEvidence(context, 'checkPacing')
    .filter(
      (item) =>
        Array.isArray(item.output.flags) &&
        item.output.flags.length === 0 &&
        !item.output.moreFlags,
    )
    .map((item) => {
      const match = /^([\d.]+)-([\d.]+)s$/.exec(String(item.output.range));
      // The last sample stands for the frames until the next one: at most 30 samples a second never reach
      // within one frame of a 60 fps film's end, so a range covers one sample interval past its last sample.
      // A pass that stopped short of the film's end never reaches past the end it requested.
      const sampleFps = Number(/ at ([\d.]+) fps/.exec(String(item.output.samples))?.[1]) || 10;
      const requestedEnd = typeof item.input.end === 'number' ? item.input.end : Infinity;
      return match
        ? { start: Number(match[1]), end: Math.min(Number(match[2]) + 1 / sampleFps, requestedEnd) }
        : { start: 0, end: 0 };
    })
    .sort((a, b) => a.start - b.start);
  let covered = 0;
  for (const range of ranges)
    if (range.start <= covered + 1 / context.timeline.fps)
      covered = Math.max(covered, range.end);
  return covered >= duration - 1 / context.timeline.fps && duration > 0
    ? []
    : ['Run checkPacing through the whole current film and resolve its flags.'];
}
