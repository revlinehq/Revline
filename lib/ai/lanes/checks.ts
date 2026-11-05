import { LANES } from './index';
import { exportConfirmed } from './export-confirmation';
import type { CheckLevel, CheckRecipe, LaneId } from './types';

/** Whole-video and comparison passes. A lane recipe without fullTools refuses them. */
export const FULL_CHECK_TOOLS = new Set(['compareReference', 'compareMotion', 'motionMap', 'checkPacing', 'previewRender', 'planEffects', 'checkSound']);

/** The final level is chosen only by intent: an export or publish request, or an explicit full double-check. */
// "published" describes earlier work, so only present-tense publishing counts.
const FINAL_INTENT = /\bpublish(?:ing)?\b|\b(?:double[- ]?check|re-?check|check|verify|review)\s+(?:everything|it all|all of it|the whole (?:thing|video|edit|film|cut))\b|\bfull (?:double[- ]?check|check|review|qa)\b/i;
// A decline must govern the request itself ("don't publish yet", "no need to double-check"), not an unrelated clause before it.
const DECLINED = /\b(?:never|without|don't|do not|don’t|no need to|not yet|skip)\s+(?:\w+\s+){0,2}(?:publish|double[- ]?check|check everything|full check)/i;
export function finalChecksRequested(request: string): boolean {
  return exportConfirmed(request) || FINAL_INTENT.test(request) && !DECLINED.test(request);
}

/** What lanes.begin stores for a request. The app and MCP both start tasks with it. */
export function requestChecks(request: string): { exportConfirmed: boolean; checkLevel?: 'final' } {
  return { exportConfirmed: exportConfirmed(request), ...(finalChecksRequested(request) ? { checkLevel: 'final' as const } : {}) };
}

/** Older task rows have no level; an export they confirmed still runs final checks. */
export function taskCheckLevel(task: { checkLevel?: CheckLevel; exportConfirmed?: boolean } | null | undefined): CheckLevel {
  return task?.checkLevel === 'final' || task?.exportConfirmed ? 'final' : 'standard';
}

export const laneChecks = (lane: LaneId, level: CheckLevel): CheckRecipe => LANES[lane].checks[level];

/** Whether edits queue getFrames times at each change and one frame either side (sample: once for plain reel styling). */
export const tracksChangedFrames = (recipe: CheckRecipe) => recipe.frames === 'changes' || recipe.frames === 'sample';

const laneName = (lane: LaneId) => lane === 'edit' || lane === 'explainer' ? 'shared editing' : lane;

export function checkInstructions(lane: LaneId, level: CheckLevel) {
  const recipe = laneChecks(lane, level), stepsUp = !equalRecipes(recipe, laneChecks(lane, 'final'));
  return `# Checks: ${laneName(lane)} lane, ${level} level
${recipe.instructions}
${stepsUp ? 'The server raises this to the lane’s full checks only for a final export or publish request, or an explicit request to double-check everything. Never ask for it or switch it yourself.\n' : ''}Keep check-level, cost and method metadata in tool results, out of user-facing replies. Add zero "How it was made", check-level or cost footers. Explain methods or costs only when the user asks. Report actual results and limitations without claiming checks you did not perform.`;
}

const equalRecipes = (a: CheckRecipe, b: CheckRecipe) => a.frames === b.frames && a.fullTools === b.fullTools && a.boundedReads === b.boundedReads && (a.clipQa ?? []).join() === (b.clipQa ?? []).join();

export function fullCheckRefusal(lane: LaneId, tool: string) {
  return `${tool} is a full check and is not part of the ${laneName(lane)} lane’s checks for this request. ${laneChecks(lane, 'standard').frames === 'data' ? 'Use finishClipping data checks and short inspectVideo windows for action moments.' : 'Use getFrames at each changed spot and one frame either side.'} Full checks run in the motion and recreate lanes, and in any lane when the user asks for a final export, publishing or a full double-check. If the deliverable changed to a new film, motion scene or recreation, switch the primary workflow first.`;
}

export const BOUNDED_READ_REFUSAL = 'This lane reads a named source window up to three seconds. Reel visual cleanup may use one stillsOnly overview (count up to 12) or batched explicit join frames (up to 30 times), without fps or momentsOnly. Reuse saved frames; no dense full-video sweeps.';
