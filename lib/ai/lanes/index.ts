import { definition as edit } from './edit/definition';
import { definition as motion } from './motion/definition';
import { definition as recreate } from './recreate/definition';
import { definition as clip } from './clip/definition';
import { definition as reel } from './reel/definition';
import { BASE_TOOLS, PROJECT_BASE_TOOLS, SKILL_TOOLS } from './base-tools';
import { editorSkills } from '../skills';
import { LANE_IDS, type LaneId } from './types';
export { LANE_IDS, type LaneId } from './types';
// Persisted legacy tasks use shared editing; this alias is never advertised.
export const LANES = { edit, motion, recreate, clip, reel, explainer: edit };
export const isLane = (value: unknown): value is LaneId =>
  LANE_IDS.some(id => id === value);

function allSkills() {
  return [...new Map([...Object.values(LANES).flatMap(lane => lane.skills), ...editorSkills()].map(skill => [skill.name, skill])).values()];
}
export function capabilityExists(name: string) {
  return isLane(name) || allSkills().some(skill => skill.name === name);
}
export function capabilityTools(name: string): readonly string[] {
  return isLane(name) ? LANES[name].tools : SKILL_TOOLS[name === 'vfx-recipes' ? 'effects' : name] ?? [];
}
export function laneToolNames(lane: LaneId, capabilities: readonly string[] = []) {
  return [...new Set([...BASE_TOOLS, ...PROJECT_BASE_TOOLS, ...LANES[lane].tools, ...capabilities.flatMap(capabilityTools)])];
}
export function laneToolAllowed(lane: LaneId, tool: string, capabilities: readonly string[] = []) {
  return laneToolNames(lane, capabilities).includes(tool);
}
/** The workflows and skills whose loading enables a tool, workflows first. Shared tools need none. */
export function toolCapabilities(tool: string): string[] {
  return [
    ...LANE_IDS.filter(lane => lane !== 'edit' && LANES[lane].tools.includes(tool)),
    ...Object.entries(SKILL_TOOLS).filter(([, names]) => names.includes(tool)).map(([name]) => name),
  ];
}
export function laneToolError(lane: LaneId, tool: string) {
  const [first, ...others] = toolCapabilities(tool);
  if (!first) return `Tool "${tool}" is not a Revline editing tool.`;
  return `Tool "${tool}" is not enabled for this ${lane === 'edit' || lane === 'explainer' ? 'shared editing' : lane} task yet. Load the ${first} capability first: loadCapability {"name":"${first}"}${others.length ? ` (also provided by ${others.slice(0, 3).join(', ')})` : ''}, then call ${tool} again. Loading keeps the task, its primary workflow and its checks; use setLane only when the deliverable itself changes.`;
}
export function discoverCapabilities(query: string) {
  const words = query.toLowerCase().split(/[^a-z0-9-]+/).filter(word => word.length > 2);
  const entries = [
    ...Object.values(LANES).filter(lane => lane.id !== 'edit').map(lane => ({ name: lane.id, kind: 'workflow', description: lane.description })),
    ...allSkills().map(skill => ({ name: skill.name, kind: 'skill', description: skill.description })),
  ];
  return entries.map(entry => ({ ...entry, score: words.reduce((score, word) => score + (`${entry.name} ${entry.description}`.toLowerCase().includes(word) ? 1 : 0), 0) }))
    .filter(entry => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 5)
    .map(({ score: _score, ...entry }) => entry);
}
export function capabilitySummary(name: string) {
  if (isLane(name)) return { name, kind: 'workflow', description: LANES[name].description, skills: LANES[name].skills.map(({name, description}) => ({name, description})), tools: capabilityTools(name) };
  const skill = allSkills().find(skill => skill.name === name);
  if (!skill) throw new Error(`Unknown capability "${name}". Search with discoverCapabilities first.`);
  return { name, kind: 'skill', description: skill.description, tools: capabilityTools(name) };
}
export function laneSkill(_lane: LaneId, name: string, page?: string) {
  const skill = allSkills().find(skill => skill.name === name);
  if (!skill) throw new Error(`Unknown skill "${name}". Search with discoverCapabilities first.`);
  const found = page ? skill.pages?.find(item => item.name === page) : undefined;
  if (page && !found) throw new Error(`Unknown page "${page}". Pages: ${skill.pages?.map(page => page.name).join(', ') || 'none'}.`);
  return found?.body ?? `${skill.body}${skill.pages?.length ? `\n\nPages (readSkill with page): ${skill.pages.map(page => `${page.name}: ${page.description}`).join('\n')}` : ''}`;
}
export const laneInstructions = (lane: LaneId) => `# Primary workflow: ${lane === 'edit' || lane === 'explainer' ? 'shared editing (no selected style)' : lane}
${LANES[lane].instructions}
Basic trims, captions, audio and timeline operations are shared. No style confirmation is needed for them or for questions.
Use discoverCapabilities for additional skills/tools and loadCapability for supporting workflows, or readSkill for a known skill. Load only what this request needs. Loading support never changes the primary deliverable, user decisions, task identity or finish obligations. Switch the primary workflow only when the requested deliverable changes; /clip and explicit user style stay authoritative.
For a one-take talking-head short-form/reel rough cut, choose reel unless the user chose another style. For separate highlights from a long source choose clip. Read the workflow skill before that work.
Call finish before reporting an editing task complete. Its server checks must pass on the current timeline. After three failed checks stop and report their actual output; never claim completion. Ask a user question with askUser when you need an answer.`;
