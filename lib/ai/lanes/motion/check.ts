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
      return match
        ? { start: Number(match[1]), end: Number(match[2]) }
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
