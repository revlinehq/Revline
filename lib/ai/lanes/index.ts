import { definition as edit } from './edit/definition';
import { definition as motion } from './motion/definition';
import { definition as recreate } from './recreate/definition';
import { definition as explainer } from './explainer/definition';
import { definition as clip } from './clip/definition';
import { definition as reel } from './reel/definition';
import { BASE_TOOLS, PROJECT_BASE_TOOLS } from './base-tools';
import { LANE_IDS, type LaneId } from './types';
export { LANE_IDS, type LaneId } from './types';
export const LANES = { edit, motion, recreate, explainer, clip, reel };
export const isLane = (value: unknown): value is LaneId =>
  LANE_IDS.includes(value as LaneId);
export function laneToolNames(lane: LaneId) {
  return [
    ...new Set([...BASE_TOOLS, ...PROJECT_BASE_TOOLS, ...LANES[lane].tools]),
  ];
}
export function laneToolAllowed(lane: LaneId, tool: string) {
  return laneToolNames(lane).includes(tool);
}
export function laneToolError(lane: LaneId, tool: string) {
  const owners = LANE_IDS.filter((id) => laneToolAllowed(id, tool));
  return `Tool "${tool}" is unavailable in the ${lane} lane. ${owners.length ? `Available in: ${owners.join(', ')}. Call switchLane (in-app) or setLane/startTask (MCP) with a lane and reason.` : 'It has not been registered in a lane.'}`;
}
export function laneSkill(lane: LaneId, name: string, page?: string) {
  const skill = LANES[lane].skills.find((skill) => skill.name === name);
  if (!skill)
    throw new Error(
      `Skill "${name}" is unavailable in the ${lane} lane. Available skills: ${LANES[lane].skills.map((skill) => skill.name).join(', ')}. Switch lanes when the task changes.`,
    );
  const found = page
    ? skill.pages?.find((item) => item.name === page)
    : undefined;
  if (page && !found)
    throw new Error(
      `Unknown page "${page}". Pages: ${skill.pages?.map((page) => page.name).join(', ') || 'none'}.`,
    );
  return (
    found?.body ??
    `${skill.body}${skill.pages?.length ? `\n\nPages (readSkill with page): ${skill.pages.map((page) => `${page.name}: ${page.description}`).join('\n')}` : ''}`
  );
}
export const laneInstructions = (lane: LaneId) => `# Task lane: ${lane}
${LANES[lane].instructions}
Skills available here: ${LANES[lane].skills.map((skill) => skill.name).join(', ')}.
Only this lane's tools are available. Use switchLane with a reason and taskType (edit or question) when the request changes.
Call finish before reporting an editing task complete. Its server checks must pass on the current timeline. After three failed checks stop and report their actual output; never claim completion. Ask a user question with askUser when you need an answer.`;
