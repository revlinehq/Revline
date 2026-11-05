import type { LaneId } from './types';

/** Only explicit controls seed the task. The editing agent reasons about every other request. */
export function initialLaneSelection(command?: { name: string }, previous?: LaneId, manual = false, explicit?: LaneId) {
  const lockedLane = command?.name === 'clip' ? 'clip' : manual && previous !== 'edit' ? previous : undefined;
  return {
    lane: lockedLane ?? explicit ?? previous ?? 'edit',
    lockedLane,
    manual: manual && previous !== 'edit' && command?.name !== 'clip',
    reason: lockedLane ? (command?.name === 'clip' ? 'Slash command /clip' : 'Explicit primary style') : 'Shared editing; optional primary workflow',
  };
}

export const MCP_SELECTION_TOOLS = new Set(['startTask', 'setLane', 'listProjects', 'getProject', 'createProject']);
