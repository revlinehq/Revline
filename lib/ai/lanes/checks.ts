import { LANES, sharedLane } from './index';
import { exportConfirmed, postRequested } from './export-confirmation';
import type { CheckLevel, CheckRecipe, LaneId } from './types';
import { MAX_SHEET_FRAMES } from '../frame-sampling';

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

// "Find three clips", "pick the best moments": the request hands the choice to Revline even when it also names a stretch to look in.
// The thing to find sits within a few words of the verb, so "select the part from 50 to 71 s and cut it into a clip" is not a search.
const FIND_MOMENTS = /\b(?:find|pick|choose|select|suggest|identify|look for|search for)(?:\s+[^\s.!?]+){0,4}?\s+(?:clips?|shorts?|moments?|highlights?)\b/i;
// "Clip this", "make 5 shorts from this podcast", "turn the stream into TikToks", "the highlights", "the best moments":
// a batch from a long source with no moments named. "Cut four clips from the trailer" is not here: it says nothing about who chooses.
const OPEN_BATCH = /\bclip\s+(?:this|it|that|the\s+(?:stream|vod|podcast|video|episode|interview|recording))\b|\b(?:make|create|generate|get|give me|want|need)\b[^.!?\n]{0,40}\b(?:clips|shorts|tiktoks|reels)\b|\b(?:cut|chop|split|break|turn)\b[^.!?\n]{0,40}\binto\b[^.!?\n]{0,20}\b(?:clips|shorts|tiktoks|reels)\b|\bhighlights?\b|\b(?:best|top|funniest|strongest|most (?:viral|interesting|engaging|exciting))\s+(?:\w+\s+){0,2}(?:clips?|shorts?|moments?|parts?|bits?|scenes?)\b/i;
const CLOCK = '\\d+(?::\\d{2}){1,2}', SECONDS = '\\d+(?:\\.\\d+)?', TIME_UNIT = '(?:s|secs?|seconds?|m|mins?|minutes?)\\b';
// "50-71 s", "0:50 to 1:11", "between 50 and 71 seconds": two times joined as a stretch. A clock time or a unit is required, so "2-3 clips" is not one.
const TIME_RANGE = new RegExp(`(?:(${CLOCK})|(${SECONDS})\\s*(${TIME_UNIT})?)\\s*(?:-|–|—|to|until|through|and)\\s*(?:(${CLOCK})|(${SECONDS})\\s*(${TIME_UNIT})?)`, 'gi');
// "clips of 30-45 seconds", "30-45 second clips", "30 to 45 s long": how long each clip should be, not where it sits in the source.
const LENGTH_BEFORE = /\b(?:of|lasting|about|around|roughly|each|length|duration|under|over)\s+$/i, LENGTH_AFTER = /^[\s-]*(?:long|each|per|clips?|shorts?|videos?|reels?)\b/i;

/** Whether the request names where in the source to cut: at least one stretch of time that is not a clip length. */
export function namesSourceRange(request: string): boolean {
  for (const match of request.matchAll(TIME_RANGE)) {
    const clock = match[1] !== undefined || match[4] !== undefined, unit = match[3] !== undefined || match[6] !== undefined;
    if (!clock && !unit) continue;
    // "and" joins a stretch only after "between"; "at 50 s and 88 s" names two moments.
    if (/\band\b/i.test(match[0]) && !/\bbetween\s+$/i.test(request.slice(0, match.index))) continue;
    if (clock) return true;
    if (!LENGTH_BEFORE.test(request.slice(0, match.index)) && !LENGTH_AFTER.test(request.slice(match.index + match[0].length))) return true;
  }
  return false;
}

/** Whether the request asks Revline to choose the moments: the /clip command (its workflow is discovery), wording
 * that asks to find them, or a batch from a long source that names no stretch to cut. A clip task without it, and
 * without a findHighlights/planClips run, cut what it was told to cut and finishes on the cheap checks alone. */
export function momentsRequested(request: string, command?: { name: string }): boolean {
  return command?.name === 'clip' || /^\s*\/clip\b/.test(request) || FIND_MOMENTS.test(request) || OPEN_BATCH.test(request) && !namesSourceRange(request);
}

/** What lanes.begin stores for a request. The app and MCP both start tasks with it. */
export function requestChecks(request: string, command?: { name: string }): { exportConfirmed: boolean; findMoments: boolean; checkLevel?: 'final'; requestedLength?: RequestedLength; postRequested?: true } {
  const length = requestedLength(request);
  return { exportConfirmed: exportConfirmed(request), findMoments: momentsRequested(request, command), ...(finalChecksRequested(request) ? { checkLevel: 'final' as const } : {}), ...(length ? { requestedLength: length } : {}), ...(!command && postRequested(request) ? { postRequested: true as const } : {}) };
}

/** Older task rows have no level; an export they confirmed still runs final checks. */
export function taskCheckLevel(task: { checkLevel?: CheckLevel; exportConfirmed?: boolean } | null | undefined): CheckLevel {
  return task?.checkLevel === 'final' || task?.exportConfirmed ? 'final' : 'standard';
}

export const laneChecks = (lane: LaneId, level: CheckLevel): CheckRecipe => LANES[lane].checks[level];

/** Whether edits are tracked as changed spots. finish draws a few of them itself, on a budget; nothing is fetched per change. */
export const tracksChangedFrames = (recipe: CheckRecipe) => recipe.frames === 'changes' || recipe.frames === 'sample';
/** A standard check looks at one contact sheet of the changed frames; a final check (fullTools) looks at all of them. */
export const changedFrameLimit = (recipe: CheckRecipe) => recipe.fullTools ? undefined : MAX_SHEET_FRAMES;

const laneName = (lane: LaneId) => sharedLane(lane) ? 'shared editing' : lane;

export function checkInstructions(lane: LaneId, level: CheckLevel) {
  const recipe = laneChecks(lane, level), stepsUp = !equalRecipes(recipe, laneChecks(lane, 'final'));
  return `# Checks: ${laneName(lane)} lane, ${level} level
${recipe.instructions}
${stepsUp ? 'The server raises this to the lane’s full checks only for a final export or publish request, or an explicit request to double-check everything. Never ask for it or switch it yourself.\n' : ''}Keep check-level, cost and method metadata in tool results, out of user-facing replies. Add zero "How it was made", check-level or cost footers. Explain methods or costs only when the user asks. Report actual results and limitations without claiming checks you did not perform.`;
}

const equalRecipes = (a: CheckRecipe, b: CheckRecipe) => a.frames === b.frames && a.fullTools === b.fullTools && a.boundedReads === b.boundedReads && (a.clipQa ?? []).join() === (b.clipQa ?? []).join();

export function fullCheckRefusal(lane: LaneId, tool: string) {
  return `${tool} is a full check and is not part of the ${laneName(lane)} lane’s checks for this request. ${laneChecks(lane, 'standard').frames === 'data' ? 'Use finishClipping data checks and short inspectVideo windows for action moments.' : 'finish draws the few frames it needs itself and returns them; use getFrames only for a spot that looks wrong.'} Full checks run when the user asks for a final export, publishing or a full double-check.`;
}

export const BOUNDED_READ_REFUSAL = 'This lane reads a named source window up to three seconds. Reel visual cleanup may use one stillsOnly overview (count up to 12) or batched explicit join frames (up to 30 times), without fps or momentsOnly. Reuse saved frames; no dense full-video sweeps.';
