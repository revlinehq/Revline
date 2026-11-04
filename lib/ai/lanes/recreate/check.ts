import { timelineDuration } from '../../../editor/types';
import { currentEvidence, type LaneCheckContext } from '../types';
import { check as motionCheck } from '../motion/check';
// Replace this conservative fallback with enforce-motion-matching's persisted gate after PR #51 merges.
export function check(context: LaneCheckContext): string[] {
  const failures = motionCheck(context),
    duration = timelineDuration(context.timeline),
    frame = 1 / context.timeline.fps;
  const full = (input: Record<string, unknown>) =>
    !input.crop &&
    !input.referenceCrop &&
    !input.timelineCrop &&
    !input.referenceCropKeyframes;
  const pixels = currentEvidence(context, 'compareReference').filter(
    (item) =>
      full(item.input) &&
      context.assets.some(
        (asset) => asset._id === item.input.assetId && asset.kind === 'video',
      ),
  );
  const motion = currentEvidence(context, 'compareMotion').filter((item) =>
    full(item.input),
  );
  const covers = (ranges: { start: number; end: number }[]) => {
    let end = 0;
    for (const range of ranges.sort((a, b) => a.start - b.start))
      if (range.start <= end + frame) end = Math.max(end, range.end);
    return duration > 0 && end >= duration - frame;
  };
  const pixelRanges = pixels.flatMap((item) => {
    const scores = item.output.scores as
      { time: number; difference: number }[] | undefined;
    if (
      !scores?.length ||
      scores.some(
        (score) => !Number.isFinite(score.difference) || score.difference > 20,
      ) ||
      Number(item.input.fps ?? 15) < 15
    )
      return [];
    const offset = Number(item.input.offset ?? 0),
      times = scores.map((score) => score.time + offset).sort((a, b) => a - b);
    return times
      .slice(1)
      .flatMap((time, index) =>
        time - times[index] <= 1 / 15 + frame
          ? [{ start: times[index], end: time }]
          : [],
      );
  });
  if (!covers(pixelRanges))
    failures.push(
      'Compare the whole current recreation at >=15 fps; pixel-difference placeholder limit is 20%. Motion-matching gate integration: PR #51.',
    );
  const motionRanges = motion.flatMap((item) =>
    Array.isArray(item.output.differences) &&
    item.output.differences.length === 0
      ? [
          {
            start: Number(item.input.timelineStart),
            end:
              Number(item.input.timelineStart) +
              Number(item.input.end) -
              Number(item.input.start),
          },
        ]
      : [],
  );
  if (!covers(motionRanges))
    failures.push(
      'Run compareMotion for every current section and resolve measured differences.',
    );
  return failures;
}
