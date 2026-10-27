import { acousticCuts } from './acoustic';
import { analyzeFrames } from './frames';
import { speechEdges } from './edges';
import { fillerWordCuts, restartCuts, retakeCuts } from './restarts';
import { DEFAULT_CLEANUP_OPTIONS, SPEECH_CLEANUP_VERSION, type CleanupCut, type CleanupOptions, type SpeechWord } from './types';

export * from './types';
export { analyzeFrames } from './frames';
export { speechEdges, type WordEdge } from './edges';

/**
 * Speech cleanup engine: finds what to cut from a talking recording, in three layers.
 * 1. Filler words a verbatim transcript kept ("um", "uh").
 * 2. Acoustic gaps and stretched words: pauses, breaths and held fillers measured in 10ms frames,
 *    which catches what a clean-text transcriber leaves out of its words.
 * 3. Restarts and retakes: repeated phrases and re-recorded sentences, keeping only the final take.
 * Returns merged, time-ordered cuts in SOURCE seconds; nothing here edits a timeline.
 */
export function findSpeechCleanup(words: SpeechWord[], samples: Float32Array, sampleRate: number, options: Partial<CleanupOptions> = {}): CleanupCut[] {
  return analyzeSpeech(words, samples, sampleRate, options).cuts;
}

/** The cleanup cuts plus each word's measured edges (in the given word order), from one pass over the audio. */
export function analyzeSpeech(words: SpeechWord[], samples: Float32Array, sampleRate: number, options: Partial<CleanupOptions> = {}) {
  const frames = analyzeFrames(samples, sampleRate);
  return { cuts: cleanupCuts(words, frames, { ...DEFAULT_CLEANUP_OPTIONS, ...options }), edges: speechEdges(words, frames) };
}

function cleanupCuts(words: SpeechWord[], frames: ReturnType<typeof analyzeFrames>, settings: CleanupOptions): CleanupCut[] {
  const sorted = [...words].sort((a, b) => a.start - b.start);
  const restarts = restartCuts(sorted, settings), fillers = fillerWordCuts(sorted);
  // Sentences are compared without their stutters and fillers, so two takes of a line match.
  const spoken = sorted.filter(word => ![...restarts, ...fillers].some(cut => word.start >= cut.start - 1e-6 && word.start < cut.end));
  const cuts = mergeCuts([...fillers, ...restarts, ...retakeCuts(spoken, settings), ...acousticCuts(sorted, frames, settings)]);
  return joinWordless(cuts, sorted);
}

/** Snap a kept source range to the measured edges of the words inside it: it starts just before the
 * first word's sound (never later than the word's transcript start) and ends just after the last
 * word's decay. A join then carries neither room tone nor a detached breath, and never a clipped word. */
export function snapToSpeech(range: { start: number; end: number }, words: SpeechWord[], edges: number[], lead = .03, tail = .05) {
  let first = -1, last = -1;
  for (let index = 0; index < words.length; index++) {
    const middle = (words[index].start + words[index].end) / 2;
    if (middle > range.start && middle < range.end) { if (first < 0) first = index; last = index; }
  }
  if (first < 0 || edges.length !== words.length * 2) return range;
  const start = Math.max(range.start, Math.min(edges[first * 2] - lead, words[first].start));
  const end = Math.min(range.end, edges[last * 2 + 1] + tail);
  return end > start ? { start, end } : range;
}

/** Overlapping cuts become one; a restart wins the label because it explains the most. */
export function mergeCuts(cuts: CleanupCut[]): CleanupCut[] {
  const rank = { restart: 3, filler: 2, breath: 1, pause: 0 } as const;
  const out: CleanupCut[] = [];
  for (const cut of [...cuts].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && cut.start <= last.end + .02) {
      last.end = Math.max(last.end, cut.end);
      if (rank[cut.kind] > rank[last.kind]) { last.kind = cut.kind; last.detail = cut.detail; }
      last.confidence = Math.max(last.confidence, cut.confidence);
    } else out.push({ ...cut });
  }
  return out;
}

/** The source ranges left after removing `cuts` from [start, end): what an editor keeps. */
export function keptRanges(start: number, end: number, cuts: CleanupCut[], minConfidence = 0): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let cursor = start;
  for (const cut of cuts) {
    if (cut.confidence < minConfidence || cut.end <= cursor || cut.start >= end) continue;
    if (cut.start > cursor) ranges.push({ start: cursor, end: Math.min(cut.start, end) });
    cursor = Math.max(cursor, cut.end);
  }
  if (cursor < end) ranges.push({ start: cursor, end });
  return ranges.filter(range => range.end - range.start >= 1 / 30);
}

/** A saved map from the current detection, safe to reuse without measuring again. */
export const currentSpeechCleanup = (cleanup?: { version?: number } | null) => cleanup?.version === SPEECH_CLEANUP_VERSION;

/** Back-to-back cuts with no spoken word between them meet: the padding left between two
 * pauses would otherwise survive as a few milliseconds of silence. Each keeps its own kind,
 * so callers can still keep or drop a kind. */
function joinWordless(cuts: CleanupCut[], words: SpeechWord[]): CleanupCut[] {
  const out = cuts.map(cut => ({ ...cut }));
  for (let index = 1; index < out.length; index++) {
    const last = out[index - 1], cut = out[index];
    if (cut.start > last.end && !words.some(word => (word.start + word.end) / 2 > last.end && (word.start + word.end) / 2 < cut.start)) last.end = cut.start;
  }
  return out;
}
