import { keptRanges, retakeEvidence, type CleanupCut } from '../../../speech-cleanup';
import { sourceEndOf } from '../../../editor/playback-rate';
import type { Timeline } from '../../../editor/types';
import type { Transcript } from '../../../media-analysis/transcript';
import { formatLength, type LengthTarget } from '../length-target';

/** Reading a talking-head take as a script: its lines, where it begins and ends, and which takes repeat. */

type Word = { text: string; start: number; end: number };
export type ScriptLine = {
  /** 1-based line number the agent refers to. */
  n: number;
  /** First and last word index in the outline's words. */
  from: number;
  to: number;
  start: number;
  end: number;
  text: string;
  /** chatter: setup or wrap-up talk around the script. earlier take: the same line is said again later. */
  note?: 'chatter' | 'earlier take';
  /** The line that says this one again. */
  takeOf?: number;
};
export type ScriptOutline = {
  words: Word[];
  lines: ScriptLine[];
  /** Stumbles and abandoned takes the words show (source seconds); a cut drops them. */
  removable: { start: number; end: number; detail: string }[];
  /** Line numbers of the first and last intended lines. */
  opening: number;
  closing: number;
  /** Two different complete openings, when the speaker started over with other words. */
  candidates?: [number, number];
};
export const BEAT_ROLES = ['hook', 'point', 'tangent', 'payoff', 'cta'] as const;
export type ScriptBeat = { role: (typeof BEAT_ROLES)[number]; from: number; to: number; priority: 1 | 2 | 3; keep?: boolean };
export type ScriptPlanInput = {
  about: string;
  beats: ScriptBeat[];
  opening?: number;
  openingReason?: string;
  endingReason?: string;
  keepLines?: number[];
};
/** What the task keeps: enough for finish to check the cut against the script without the model. */
export type SavedScript = {
  version: 1;
  assetId: string;
  clipId: string;
  about: string;
  opening: { line: number; start: number; text: string };
  closing: { line: number; end: number; text: string };
  beats: (ScriptBeat & { text: string })[];
  keepLines: number[];
  openingReason?: string;
  endingReason?: string;
  target?: LengthTarget;
  estimatedSeconds: number;
  removedTakes: number;
};

const FILLERS = new Set(['um', 'uh', 'erm', 'er', 'ah', 'hmm', 'mm', 'uhm']);
const token = (text: string) => text.toLowerCase().replace(/[^a-z0-9']/g, '');
// A doubled function word is a stutter ("the the"); a doubled content word ("very, very") can be meant.
const STUTTER_WORDS = new Set(['i', 'the', 'a', 'an', 'and', 'so', 'but', 'it', 'we', 'you', 'to', 'of', 'in', 'that', 'this', 'is', "it's", "i'm", 'my', 'our', 'they', 'he', 'she', 'if', 'when', 'because', 'like', 'for', 'on', 'with', 'at', 'what', 'how', 'why', 'or']);
// Talk about the recording itself, never part of a script. Matched on short lines only.
const SETUP = /\b(mic check|testing|test one two|check one two|one two three|is (this|it|that) (thing )?(recording|on|working|rolling)|are we (recording|rolling|live|good)|we('re| are) (recording|rolling)|(recording|rolling) now|can you hear|let me (just )?(start|try|do|fix|check|adjust|see|get|redo|say|go)|let'?s (go|do this|start|try)|here we go|hold on|is the (camera|mic|light)|camera('s| is) (on|rolling)|three two one|3 2 1|and action)\b/;
const RESTART = /\b((start|go|try|do|say) (it |that |this )?(again|over)|one more (time|take)|take (two|three|four|\d+)|from the top|scratch that|my bad|messed (that |it )?up|where was i|what was i|let me (redo|restart|start|try))\b/;
const WRAP = /\b(cut|that'?s (it|a wrap|the one|good)|i think (that'?s|we('re| are)|that was) (it|good|done)|stop (the )?recording|(was|is) that (ok|okay|good|alright)|how was that|we got it|got it|end of (recording|take)|let me (stop|check|watch|see)|turn (it|this|the camera) off|nailed it|good take)\b/;
const NOISE = new Set(['ok', 'okay', 'alright', 'right', 'so', 'cool', 'yeah', 'yep', 'well', 'sorry', 'wait', 'ready', 'action', 'done', 'perfect', 'good', 'great', 'cut', 'and']);

/** Longest common subsequence length of two token lists. */
function common(a: string[], b: string[]) {
  let previous = new Array(b.length + 1).fill(0);
  for (const item of a) {
    const row = [0];
    for (let j = 0; j < b.length; j++) row.push(item === b[j] ? previous[j] + 1 : Math.max(previous[j + 1], row[j]));
    previous = row;
  }
  return previous[b.length];
}

/** The take as numbered lines with its opening, closing, chatter and repeated takes. Deterministic. */
export function scriptOutline(transcript: Pick<Transcript, 'words'>, range?: { start: number; end: number }): ScriptOutline {
  const evidence = retakeEvidence(transcript.words.filter(word => !range || (word.start + word.end) / 2 > range.start && (word.start + word.end) / 2 < range.end));
  const words: Word[] = evidence.sorted;
  const stutters = evidence.restarts.filter(cut => { const tokens = cut.detail.split(/\s+/).map(token).filter(Boolean); return tokens.length > 1 || STUTTER_WORDS.has(tokens[0] ?? ''); });
  const removable = [...stutters, ...evidence.retakes].sort((a, b) => a.start - b.start).map(cut => ({ start: cut.start, end: cut.end, detail: cut.detail }));
  const removed = (word: Word) => { const middle = (word.start + word.end) / 2; return removable.some(cut => middle >= cut.start && middle < cut.end); };
  const punctuated = words.some(word => /[.!?]["')\]]?$/.test(word.text));
  const lines: ScriptLine[] = [];
  let from = 0;
  words.forEach((word, index) => {
    const next = words[index + 1];
    if (next && !/[.!?…]["')\]]?$/.test(word.text) && next.start - word.end <= (punctuated ? 1.2 : .6)) return;
    lines.push({ n: lines.length + 1, from, to: index, start: words[from].start, end: word.end, text: words.slice(from, index + 1).map(item => item.text).join(' ') });
    from = index + 1;
  });
  const spoken = (line: ScriptLine) => words.slice(line.from, line.to + 1).filter(word => token(word.text) && !FILLERS.has(token(word.text)));
  const tokens = lines.map(line => spoken(line).map(word => token(word.text)));
  // A line the cleanup evidence mostly removes is an earlier take of a later line.
  lines.forEach((line, index) => {
    const said = spoken(line);
    if (!said.length || said.filter(removed).length < said.length * .7) return;
    line.note = 'earlier take';
    let best = 0;
    for (let later = index + 1; later < lines.length && lines[later].start - line.end <= 90; later++) {
      const score = common(tokens[index], tokens[later]) / Math.max(1, tokens[index].length);
      if (score > best + .001 && score >= .4) { best = score; line.takeOf = lines[later].n; }
    }
  });
  const short = (index: number) => tokens[index].length <= 8;
  const noise = (index: number) => tokens[index].length <= 3 && tokens[index].every(item => NOISE.has(item));
  const text = (index: number) => tokens[index].join(' ');
  const setup = (index: number) => !tokens[index].length || noise(index) || short(index) && (SETUP.test(text(index)) || RESTART.test(text(index)));
  const wrap = (index: number) => setup(index) || short(index) && WRAP.test(text(index));
  let first = 0;
  while (first < lines.length && (lines[first].note || setup(first))) first++;
  let last = lines.length - 1;
  while (last > first && (lines[last].note || wrap(last))) last--;
  // Nothing reads as a script line: treat the whole take as the script rather than guess.
  if (first >= lines.length) { first = 0; last = lines.length - 1; }
  lines.forEach((line, index) => {
    if (line.note) return;
    if (index < first || index > last || short(index) && RESTART.test(text(index))) line.note = 'chatter';
  });
  const outline: ScriptOutline = { words, lines, removable, opening: lines[first]?.n ?? 1, closing: lines[last]?.n ?? 1 };
  // "Let me start over" after a complete, different opening: two openings the words cannot choose between.
  const total = (words.at(-1)?.end ?? 0) - (words[0]?.start ?? 0);
  for (let index = first + 1; index < last; index++) {
    if (lines[index].note !== 'chatter' || lines[index].start - (words[0]?.start ?? 0) > total * .4) continue;
    const after = lines.slice(index + 1, last + 1).find(line => !line.note);
    if (after && tokens[first].length >= 3) outline.candidates = [lines[first].n, after.n];
    break;
  }
  return outline;
}

const quote = (text: string, count = 7, tail = false) => { const parts = text.split(/\s+/); return JSON.stringify(parts.length <= count ? text : tail ? `… ${parts.slice(-count).join(' ')}` : `${parts.slice(0, count).join(' ')} …`); };
const seconds = (value: number) => `${value.toFixed(1)} s`;
export const lineLabel = (line: ScriptLine) => `L${line.n} ${quote(line.text)} (${seconds(line.start)})`;

/** Lines for the model: one short string each, so a long take stays cheap to read. */
export function outlineLines(outline: ScriptOutline) {
  const long = outline.lines.length > 250;
  return outline.lines.map(line => {
    const parts = line.text.split(/\s+/);
    const shown = long && parts.length > 16 ? `${parts.slice(0, 10).join(' ')} … ${parts.slice(-4).join(' ')}` : line.text;
    return `L${line.n} ${line.start.toFixed(1)}-${line.end.toFixed(1)}${line.note ? ` [${line.note}${line.takeOf ? ` of L${line.takeOf}` : ''}]` : ''} ${shown}`;
  });
}

/** Source ranges that keep these lines whole: neighbours join, stumbles and abandoned takes inside are left out. */
export function linesToRanges(outline: ScriptOutline, kept: number[]) {
  const { words, lines } = outline, ranges: { start: number; end: number }[] = [];
  const cuts: CleanupCut[] = outline.removable.map(cut => ({ ...cut, kind: 'restart', confidence: 1 }));
  const sorted = [...new Set(kept)].sort((a, b) => a - b);
  for (let index = 0; index < sorted.length; index++) {
    const first = lines[sorted[index] - 1];
    while (sorted[index + 1] === sorted[index] + 1) index++;
    const last = lines[sorted[index] - 1];
    const start = Math.max(words[first.from - 1]?.end ?? 0, first.start - .12), end = Math.min(words[last.to + 1]?.start ?? Infinity, last.end + .2);
    ranges.push(...keptRanges(start, end, cuts).filter(range => words.some(word => { const middle = (word.start + word.end) / 2; return middle > range.start && middle < range.end; })));
  }
  return ranges.map(range => ({ start: Math.round(range.start * 1000) / 1000, end: Math.round(range.end * 1000) / 1000 }));
}

/** Turn the model's reading into kept lines, or say exactly what is wrong with it. */
export function resolveScriptPlan(outline: ScriptOutline, input: ScriptPlanInput) {
  const { lines } = outline, problems: string[] = [], count = lines.length, forced = new Set(input.keepLines ?? []);
  const line = (n: number) => lines[n - 1];
  for (const beat of input.beats) if (beat.from > beat.to || beat.from < 1 || beat.to > count) problems.push(`Beat ${beat.role} L${beat.from}-L${beat.to} is outside lines L1-L${count}.`);
  if (problems.length) return { problems, kept: [] as number[] };
  const inBeat = new Set(input.beats.flatMap(beat => Array.from({ length: beat.to - beat.from + 1 }, (_, i) => beat.from + i)));
  const kept = new Set<number>();
  for (const beat of input.beats) if (beat.keep !== false) for (let n = beat.from; n <= beat.to; n++) if (!line(n).note || forced.has(n)) kept.add(n);
  if (input.opening !== undefined) {
    if (!line(input.opening)) problems.push(`opening L${input.opening} is not a line.`);
    else { for (const n of [...kept]) if (n < input.opening) kept.delete(n); kept.add(input.opening); }
  }
  const order = [...kept].sort((a, b) => a - b), first = order[0], last = order.at(-1);
  if (first === undefined || last === undefined) return { problems: [...problems, 'The plan keeps no line. Put the script lines in beats.'], kept: order };
  const chosen = outline.candidates?.includes(first) && input.opening === first;
  if (outline.candidates && !chosen && !input.openingReason)
    problems.push(`The take has two different complete openings: ${outline.candidates.map(n => lineLabel(line(n))).join(' and ')}. Ask the user which one opens the reel (askUser with these two lines as options), then pass opening with that line number.`);
  else if (first > outline.opening && !chosen && !input.openingReason)
    problems.push(`The script opens at ${lineLabel(line(outline.opening))} but this plan starts at ${lineLabel(line(first))}. Start at L${outline.opening}; pass openingReason only when the user asked for a different hook.`);
  if (last < outline.closing && !input.endingReason)
    problems.push(`The script ends at ${lineLabel(line(outline.closing))} but this plan stops at ${lineLabel(line(last))}. Keep the payoff and closing line; pass endingReason only when the user asked to end earlier.`);
  const loose = lines.filter(item => !item.note && item.n > first && item.n < last && !inBeat.has(item.n));
  if (loose.length) problems.push(`These script lines are in no beat: ${loose.slice(0, 8).map(item => `L${item.n}`).join(', ')}. Put every script line in a beat; drop a whole beat with keep:false.`);
  for (const n of order) { const again = line(n).takeOf; if (line(n).note === 'earlier take' && again && kept.has(again)) problems.push(`L${n} and L${again} are takes of the same line. Keep one (L${again} is the last complete take).`); }
  return { problems, kept: order };
}

/** Which whole middle beats to drop, lowest priority first, so the cut lands inside the requested length. */
export function beatsToDrop(beats: { index: number; priority: number; seconds: number; droppable: boolean }[], estimate: number, target: LengthTarget) {
  if (target.max === undefined || estimate <= target.max + .5) return [];
  const drop: number[] = [];
  let length = estimate;
  const candidates = beats.filter(beat => beat.droppable && beat.seconds > 0).sort((a, b) => b.priority - a.priority || a.seconds - b.seconds);
  for (const [position, beat] of candidates.entries()) {
    if (length <= target.max + .5) break;
    // A larger beat of the same priority that lands inside the range beats several small ones that overshoot.
    const fitting = candidates.slice(position).find(item => item.priority === beat.priority && !drop.includes(item.index) && length - item.seconds <= target.max! + .5 && length - item.seconds >= (target.min ?? 0) - .5);
    const pick = fitting ?? beat;
    if (drop.includes(pick.index)) continue;
    drop.push(pick.index);
    length -= pick.seconds;
  }
  return length <= target.max + .5 ? drop.sort((a, b) => a - b) : [];
}

type CheckAsset = { _id: string; audioAssetId?: string; analysis?: { transcript?: Transcript } };

/** Finish: the cut must begin on the script's opening line, end on its closing line, and keep each line whole. */
export function reelScriptFailures(timeline: Timeline, assets: CheckAsset[], script?: SavedScript | null): string[] {
  if (!script) return [];
  const asset = assets.find(item => item._id === script.assetId), transcript = asset?.analysis?.transcript;
  if (!asset || !transcript?.words.length) return [];
  const spans = timeline.clips.filter(clip => (clip.kind === 'video' || clip.kind === 'audio') && (clip.assetId === asset._id || !!asset.audioAssetId && clip.assetId === asset.audioAssetId))
    .map(clip => ({ start: clip.sourceStart, end: sourceEndOf(clip) }));
  // The take left the timeline: nothing of this script to check.
  if (!spans.length) return [];
  const outline = scriptOutline(transcript), { words, lines } = outline;
  const kept = (word: Word) => { const middle = (word.start + word.end) / 2; return spans.some(span => middle >= span.start && middle < span.end); };
  const retained = words.filter(kept);
  if (!retained.length) return [];
  const failures: string[] = [], head = retained[0], tail = retained.at(-1)!;
  const said = (from: Word[]) => quote(from.map(word => word.text).join(' '), 5);
  if (head.start > script.opening.start + .5)
    failures.push(`The cut starts mid-script at ${said(retained.slice(0, 5))} (source ${seconds(head.start)}). The script opens with ${quote(script.opening.text)} at source ${seconds(script.opening.start)}: begin the reel on that line.`);
  else if (head.start < script.opening.start - .5)
    failures.push(`The cut starts at ${said(retained.slice(0, 5))} (source ${seconds(head.start)}), before the script's opening line ${quote(script.opening.text)} at source ${seconds(script.opening.start)}. Remove that setup talk or earlier take.`);
  if (tail.end < script.closing.end - .5)
    failures.push(`The cut ends at ${quote(retained.slice(-5).map(word => word.text).join(' '), 5, true)} (source ${seconds(tail.end)}), before the script's closing line ${quote(script.closing.text, 7, true)} that ends at source ${seconds(script.closing.end)}. Keep the ending.`);
  else if (tail.end > script.closing.end + .5)
    failures.push(`The cut runs past the script's closing line ${quote(script.closing.text, 7, true)} (ends at source ${seconds(script.closing.end)}) into ${quote(retained.slice(-5).map(word => word.text).join(' '), 5, true)}. Remove the talk after the script.`);
  const removed = (word: Word) => { const middle = (word.start + word.end) / 2; return FILLERS.has(token(word.text)) || !token(word.text) || outline.removable.some(cut => middle >= cut.start && middle < cut.end); };
  for (const line of lines) {
    const all = words.slice(line.from, line.to + 1), present = all.filter(kept);
    if (!present.length) continue;
    if (line.note === 'earlier take' && line.takeOf && !script.keepLines.includes(line.n) && words.slice(lines[line.takeOf - 1].from, lines[line.takeOf - 1].to + 1).some(kept)) {
      failures.push(`Two takes of the same line are in the cut: ${quote(line.text)} (source ${seconds(line.start)}) and its later take at source ${seconds(lines[line.takeOf - 1].start)}. Keep only the later one.`);
      continue;
    }
    const needed = all.filter(word => !removed(word));
    if (!needed.length || line.note) continue;
    if (!kept(needed[0])) failures.push(`A sentence is cut mid-sentence: the cut keeps ${said(present.slice(0, 5))} (source ${seconds(present[0].start)}) without the start of its line ${quote(line.text)} (source ${seconds(line.start)}). Keep the whole line or drop it.`);
    else if (!kept(needed.at(-1)!)) failures.push(`A sentence is cut mid-sentence: ${quote(line.text)} (source ${seconds(line.start)}) stops at ${quote(present.slice(-4).map(word => word.text).join(' '), 4, true)} (source ${seconds(present.at(-1)!.end)}) before its end. Keep the whole line or drop it.`);
  }
  return failures.slice(0, 5);
}

/** Finish: a length the user asked for is met by the timeline, not by the plan's estimate. */
export function reelLengthCheck(duration: number, target?: LengthTarget | null, script?: SavedScript | null): { failures: string[]; warnings: string[] } {
  if (!target || duration <= 0) return { failures: [], warnings: [] };
  const asked = `requested ${formatLength(target)}, timeline is ${seconds(duration)}`;
  if (target.max !== undefined && duration > target.max + .5)
    return { failures: [`Length: ${asked}. Drop a whole lower-priority beat, tangent or redundant take and tighten pauses; never the opening or the payoff, never mid-sentence.`], warnings: [] };
  if (target.min !== undefined && duration < target.min - .5) {
    const dropped = script?.beats.some(beat => beat.keep === false);
    const message = `Length: ${asked}.`;
    return dropped ? { failures: [`${message} Restore a dropped beat instead of padding.`], warnings: [] } : { failures: [], warnings: [`${message} The whole script is kept; nothing was padded.`] };
  }
  return { failures: [], warnings: [] };
}
