import type { LaneCheckContext } from '../types';
import { referenceMotionFailures } from './motion';

export function check(context: LaneCheckContext): string[] {
  if (context.referenceMotion?.length) return referenceMotionFailures(context);
  const video = context.assets.find(asset => asset.kind === 'video');
  return [video
    ? `Identify the actual reference with readFrames ${JSON.stringify({ assetId: video._id, start: 0, end: video.duration ?? 12, count: 16 })}, then bind the film with addFilm or patchScene. No reference motion has been certified.`
    : 'Use askUser to request the missing reference video before claiming a recreation match.'];
}
