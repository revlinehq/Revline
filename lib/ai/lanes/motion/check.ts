import { type LaneCheckContext } from '../types';
import { referenceMotionFailures } from '../recreate/motion';
/** Original films set their timing while writing (motion-design "Timing and easing"); only films bound to a reference are compared. */
export function check(context: LaneCheckContext): string[] {
  if (context.referenceMotion?.length) return referenceMotionFailures(context);
  return [];
}
