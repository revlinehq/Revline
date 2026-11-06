import type { LaneCheckContext } from '../types';
import { referenceMotionFailures } from './motion';
import { filmChecks } from '../motion/film-checks';

/** Recreations keep the reference's measured timing, so only the contract limits are checked on their code. */
export function check(context: LaneCheckContext): string[] {
  const limits = filmChecks(context.timeline, { timing: false }).failures;
  if (context.referenceMotion?.length) return [...limits, ...referenceMotionFailures(context)];
  const video = context.assets.find(asset => asset.kind === 'video');
  return [...limits, video
    ? `Identify the actual reference with readFrames ${JSON.stringify({ assetId: video._id, start: 0, end: video.duration ?? 12, count: 16 })}, then bind the film with addFilm or patchScene. No reference motion has been certified.`
    : 'Use askUser to request the missing reference video before claiming a recreation match.'];
}
