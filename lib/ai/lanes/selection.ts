import type { LaneId } from './types';

// "Edit my rough for a reel", "make this a reel", "clean my rough cut": one talking take into a short.
// "short" alone is an adjective ("a short fade"), so only the nouns count.
const REEL_REQUEST = /\b(?:reels?|short[- ]form|tiktoks?|youtube shorts?)\b|\brough\s+cut\b|\bmy\s+rough\b/i;
// Several separate shorts from a long source are clipping.
const OTHER_DELIVERABLE = /\b(?:clips|highlights|best (?:moments|parts))\b/i;

/** A reel request on a timeline holding one piece of footage. */
export function reelRequested(request: string | undefined, timeline?: { clips: { kind: string; assetId?: string }[] }) {
  if (!request || !REEL_REQUEST.test(request) || OTHER_DELIVERABLE.test(request)) return false;
  if (!timeline) return true;
  const footage = new Set(timeline.clips.filter(clip => clip.kind === 'video').map(clip => clip.assetId));
  return footage.size === 1;
}

/** Explicit controls seed the task; a reel request on one take starts in the reel workflow. The agent reasons about every other request. */
export function initialLaneSelection(command?: { name: string }, previous?: LaneId, manual = false, explicit?: LaneId, reel = false) {
  const lockedLane = command?.name === 'clip' ? 'clip' : manual && previous !== 'edit' ? previous : undefined;
  const reelLane = !lockedLane && !explicit && reel && (!previous || previous !== 'clip' && previous !== 'reel');
  return {
    lane: lockedLane ?? explicit ?? (reelLane ? 'reel' as const : previous ?? 'edit'),
    lockedLane,
    manual: manual && previous !== 'edit' && command?.name !== 'clip',
    reason: lockedLane ? (command?.name === 'clip' ? 'Slash command /clip' : 'Explicit primary style') : reelLane ? 'Reel request on one talking-head take' : 'Shared editing; optional primary workflow',
  };
}

export const MCP_SELECTION_TOOLS = new Set(['startTask', 'setLane', 'listProjects', 'getProject', 'createProject']);
