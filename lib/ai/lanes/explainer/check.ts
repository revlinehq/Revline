import type { LaneCheckContext } from '../types';
import { check as motionCheck } from '../motion/check';
export function check(context: LaneCheckContext): string[] {
  const failures = motionCheck(context);
  if (
    !context.timeline.clips.some(
      (clip) => clip.kind === 'audio' && clip.audio?.role === 'voice',
    )
  )
    failures.push(
      'Place the narrated voice track before finishing the explainer.',
    );
  return failures;
}
