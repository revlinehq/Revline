import { type LaneCheckContext } from '../types';
import { referenceMotionFailures } from '../recreate/motion';
import { filmChecks } from './film-checks';
/** Original films get the timing and limit checks on their saved code; films bound to a reference are compared to it instead. */
export function check(context: LaneCheckContext): string[] {
  return [...filmChecks(context.timeline, { timing: !context.referenceMotion?.length }).failures, ...(context.referenceMotion?.length ? referenceMotionFailures(context) : [])];
}
export function warn(context: LaneCheckContext): string[] {
  return filmChecks(context.timeline, { timing: !context.referenceMotion?.length }).warnings;
}
