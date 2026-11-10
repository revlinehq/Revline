import { LANES, sharedLane } from './index';
import { exportConfirmed } from './export-confirmation';
import type { CheckLevel, CheckRecipe, LaneId } from './types';

/** Whole-video passes. A lane recipe without fullTools refuses them. */
export const FULL_CHECK_TOOLS = new Set(['checkPacing', 'previewRender', 'planEffects', 'checkSound']);

/** The final level is chosen only by intent: an export or publish request, or an explicit full double-check. */
// "published" describes earlier work, so only present-tense publishing counts.
const FINAL_INTENT = /\bpublish(?:ing)?\b|\b(?:double[- ]?check|re-?check|check|verify|review)\s+(?:everything|it all|all of it|the whole (?:thing|video|edit|cut))\b|\bfull (?:double[- ]?check|check|review|qa)\b/i;
// A decline must govern the request itself ("don't publish yet", "no need to double-check"), not an unrelated clause before it.
const DECLINED = /\b(?:never|without|don't|do not|don’t|no need to|not yet|skip)\s+(?:\w+\s+){0,2}(?:publish|double[- ]?check|check everything|full check)/i;
export function finalChecksRequested(request: string): boolean {
  return exportConfirmed(request) || FINAL_INTENT.test(request) && !DECLINED.test(request);
}

/** A length the user asked the finished video to have, in seconds. */
export type RequestedLength = { min?: number; max?: number };
const LENGTH_UNIT = '(s|secs?|seconds?|m|mins?|minutes?)\\b';
// "and" joins a range only after "between"; bare "10 and 20 seconds" names two moments.
const LENGTH_RANGE = new RegExp(`(?:(between\\s+)(\\d+(?:\\.\\d+)?)\\s*and|(\\d+(?:\\.\\d+)?)\\s*(?:-|–|—|to))\\s*(\\d+(?:\\.\\d+)?)\\s*-?\\s*${LENGTH_UNIT}`, 'gi');
// Only wording that bounds the whole video. "shorter than", "over" and the like usually describe clips, pauses or fades.
const LENGTH_CAP = new RegExp(`\\b(?:under|below|at most|max(?:imum)?(?: of)?|no (?:longer|more) than)\\s+(\\d+(?:\\.\\d+)?)\\s*-?\\s*${LENGTH_UNIT}`, 'i');
const LENGTH_FLOOR = new RegExp(`\\b(?:at least|min(?:imum)?(?: of)?|no (?:shorter|less) than)\\s+(\\d+(?:\\.\\d+)?)\\s*-?\\s*${LENGTH_UNIT}`, 'i');
// A range right after these words is a place on the timeline ("remove 40-50s", "from 40 to 50 s"), not a length.
const POSITION_BEFORE = /\b(?:from|at|after|before|until|till|remove|delete|drop|cut out|trim|mute|speed up|slow down|blur|zoom(?: in| out)?(?: on)?|during|over|first|last|part|section|around the)\s+(?:the\s+)?$/i;
const LENGTH_CUE = /\b(?:long|length|duration|runtime|total|reel|short|shorts|video|version|cut|edit|clip|tiktok|make it|keep it|get it|bring it)\b/i;
const lengthSeconds = (value: string, unit: string) => Number(value) * (/^m/i.test(unit) ? 60 : 1);
// Pause and clip thresholds are a few seconds; a whole video is not.
const plausibleLength = (value: number | undefined) => value === undefined || value >= 5 && value <= 3600;

/** Only an explicit length for the whole video counts: a range ("40-50 seconds") or a bound ("under 60 s"). */
export function requestedLength(request: string): RequestedLength | undefined {
  if (!LENGTH_CUE.test(request)) return;
  for (const range of request.matchAll(LENGTH_RANGE)) {
    if (!range[1] && POSITION_BEFORE.test(request.slice(0, range.index))) continue;
    const min = lengthSeconds(range[2] ?? range[3], range[5]), max = lengthSeconds(range[4], range[5]);
    if (max > min && plausibleLength(min) && plausibleLength(max)) return { min, max };
  }
  const cap = LENGTH_CAP.exec(request), floor = LENGTH_FLOOR.exec(request);
  const max = cap ? lengthSeconds(cap[1], cap[2]) : undefined, min = floor ? lengthSeconds(floor[1], floor[2]) : undefined;
  if (max === undefined && min === undefined || !plausibleLength(min) || !plausibleLength(max) || min !== undefined && max !== undefined && min >= max) return;
  return { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
}

/** The finish failure for a timeline outside the requested length; one frame of slack. */
export function requestedLengthFailure(target: RequestedLength | undefined, duration: number, fps: number): string | undefined {
  if (!target) return;
  const short = target.min !== undefined && duration < target.min - 1 / fps, long = target.max !== undefined && duration > target.max + 1 / fps;
  if (!short && !long) return;
  const asked = target.min !== undefined && target.max !== undefined ? `${target.min}–${target.max} s` : target.max !== undefined ? `at most ${target.max} s` : `at least ${target.min} s`;
  return `Requested length ${asked}; the timeline is ${duration.toFixed(1)} s. ${long ? `Cut ${(duration - target.max!).toFixed(1)} s or more` : `Keep ${(target.min! - duration).toFixed(1)} s more`}, or if the message cannot fit, stop and tell the user the actual length.`;
}

/** What lanes.begin stores for a request. The app and MCP both start tasks with it. */
export function requestChecks(request: string): { exportConfirmed: boolean; checkLevel?: 'final'; requestedLength?: RequestedLength } {
  const length = requestedLength(request);
  return { exportConfirmed: exportConfirmed(request), ...(finalChecksRequested(request) ? { checkLevel: 'final' as const } : {}), ...(length ? { requestedLength: length } : {}) };
}

/** Older task rows have no level; an export they confirmed still runs final checks. */
export function taskCheckLevel(task: { checkLevel?: CheckLevel; exportConfirmed?: boolean } | null | undefined): CheckLevel {
  return task?.checkLevel === 'final' || task?.exportConfirmed ? 'final' : 'standard';
}

export const laneChecks = (lane: LaneId, level: CheckLevel): CheckRecipe => LANES[lane].checks[level];

/** Whether edits queue getFrames times at each change and one frame either side (sample: once for plain reel styling). */
export const tracksChangedFrames = (recipe: CheckRecipe) => recipe.frames === 'changes' || recipe.frames === 'sample';

const laneName = (lane: LaneId) => sharedLane(lane) ? 'shared editing' : lane;

export function checkInstructions(lane: LaneId, level: CheckLevel) {
  const recipe = laneChecks(lane, level), stepsUp = !equalRecipes(recipe, laneChecks(lane, 'final'));
  return `# Checks: ${laneName(lane)} lane, ${level} level
${recipe.instructions}
${stepsUp ? 'The server raises this to the lane’s full checks only for a final export or publish request, or an explicit request to double-check everything. Never ask for it or switch it yourself.\n' : ''}Keep check-level, cost and method metadata in tool results, out of user-facing replies. Add zero "How it was made", check-level or cost footers. Explain methods or costs only when the user asks. Report actual results and limitations without claiming checks you did not perform.`;
}

const equalRecipes = (a: CheckRecipe, b: CheckRecipe) => a.frames === b.frames && a.fullTools === b.fullTools && a.boundedReads === b.boundedReads && (a.clipQa ?? []).join() === (b.clipQa ?? []).join();

export function fullCheckRefusal(lane: LaneId, tool: string) {
  return `${tool} is a full check and is not part of the ${laneName(lane)} lane’s checks for this request. ${laneChecks(lane, 'standard').frames === 'data' ? 'Use finishClipping data checks and short inspectVideo windows for action moments.' : 'Use getFrames at each changed spot and one frame either side.'} Full checks run when the user asks for a final export, publishing or a full double-check.`;
}

export const BOUNDED_READ_REFUSAL = 'This lane reads a named source window up to three seconds. Reel visual cleanup may use one stillsOnly overview (count up to 12) or batched explicit join frames (up to 30 times), without fps or momentsOnly. Reuse saved frames; no dense full-video sweeps.';
