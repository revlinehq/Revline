import { LANES, type LaneId } from './index';

/** Only explicit controls seed the task. The editing agent reasons about every other request. */
export function initialLaneSelection(command?: { name: string }, previous?: LaneId, manual = false, explicit?: LaneId) {
  const lockedLane = command?.name === 'clip' ? 'clip' : manual ? previous : undefined;
  return {
    lane: lockedLane ?? explicit ?? previous ?? 'edit',
    lockedLane,
    manual: manual && command?.name !== 'clip',
    reason: lockedLane ? (manual && command?.name !== 'clip' ? 'User-selected lane for this timeline' : 'Slash command /clip') : 'Awaiting agent lane choice',
  };
}

export const laneDescriptions = () => Object.values(LANES).map(({ id, description }) => `${id}: ${description}`).join('\n');
export function laneChoiceInstructions(current: LaneId, locked?: LaneId) {
  return `# Choose the task lane before working
${laneDescriptions()}
Use your judgment about the user's request, project brief and attached media. There is no classifier or keyword fallback.
Current timeline lane: ${current}. For a follow-up, keep it unless the kind of work changed. ${locked ? `The user explicitly selected ${locked}; you must keep that lane.` : 'For a new task, choose the lane that fits the work.'}
Your first action must be switchLane (in-app) or setLane (MCP), with the lane, a concrete reason and taskType: edit or question. Confirming the current lane is valid.
Choose edit whenever the request asks you to create or change a video, including requests phrased as questions. Choose question only for information or discussion without edits. A question needs no finish check; actual timeline edits always require finish. /clip always requires completion checks.
Only lane-selection controls are available until this choice succeeds. After choosing, read that lane’s skill pages and use its tools.`;
}

export const MCP_SELECTION_TOOLS = new Set(['startTask', 'setLane', 'listProjects', 'getProject', 'createProject']);
