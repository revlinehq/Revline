import { acousticCuts } from './acoustic';
import { analyzeFrames } from './frames';
import { speechEdges } from './edges';
import { fillerWordCuts, restartCuts, retakeCuts } from './restarts';
import { DEFAULT_CLEANUP_OPTIONS, SPEECH_CLEANUP_VERSION, type CleanupCut, type CleanupOptions, type SpeechWord, type WordEdge } from './types';

export * from './types';
export { analyzeFrames } from './frames';
export { speechEdges } from './edges';

/** The cleanup cuts plus each word's measured edges (in the given word order), from one pass over the audio. */
export function analyzeSpeech(words: SpeechWord[], samples: Float32Array, sampleRate: number, options: Partial<CleanupOptions> = {}) {
  const frames = analyzeFrames(samples, sampleRate);
  const edges = speechEdges(words, frames);
  return { cuts: cleanupCuts(words, edges, frames, { ...DEFAULT_CLEANUP_OPTIONS, ...options }), edges };
}

function cleanupCuts(words: SpeechWord[], edges: WordEdge[], frames: ReturnType<typeof analyzeFrames>, settings: CleanupOptions): CleanupCut[] {
  const { sorted, restarts, fillers, retakes } = retakeEvidence(words, settings);
  const cuts = mergeCuts([...fillers, ...restarts, ...retakes, ...acousticCuts(sorted, frames, settings, edges)]);
  return joinWordless(cuts, sorted);
}

/** What the words alone show, without audio: repeated-phrase restarts, filler words and re-recorded
 * sentences (the last take is kept). The cleanup map and the reel script outline share it. */
export function retakeEvidence(words: SpeechWord[], settings: CleanupOptions = DEFAULT_CLEANUP_OPTIONS) {
  const sorted = [...words].sort((a, b) => a.start - b.start);
  const restarts = restartCuts(sorted, settings), fillers = fillerWordCuts(sorted);
  // Sentences are compared without their stutters and fillers, so two takes of a line match.
  const spoken = sorted.filter(word => ![...restarts, ...fillers].some(cut => word.start >= cut.start - 1e-6 && word.start < cut.end));
  return { sorted, restarts, fillers, retakes: retakeCuts(spoken, settings) };
}

/** Snap a kept source range to the measured edges of the words inside it: it starts just before the
 * first word's sound (at most 80ms earlier, for soft onsets like "th") and ends just after the last
 * word's decay. A join then carries neither room tone nor a detached breath, and never a clipped word. */
export function snapToSpeech(range: { start: number; end: number }, words: SpeechWord[], edges: number[], lead = .03, tail = .05) {
  if (edges.length !== words.length * 2) return range;
  let first = -1, last = -1;
  for (let index = 0; index < words.length; index++) {
    // Membership by the word's measured sound, not its padded transcript span.
    const middle = (edges[index * 2] + edges[index * 2 + 1]) / 2;
    if (middle > range.start && middle < range.end) { if (first < 0) first = index; last = index; }
  }
  if (first < 0) return range;
  const onset = edges[first * 2];
  const start = Math.max(range.start, Math.min(onset - lead, Math.max(words[first].start, onset - .08)));
  const end = Math.min(range.end, edges[last * 2 + 1] + tail);
  return end > start ? { start, end } : range;
}

/** Overlapping cuts of the same kind become one. Different kinds stay separate (and may overlap),
 * so a caller that keeps restarts still removes the pauses inside them. Sorted by start. */
function mergeCuts(cuts: CleanupCut[]): CleanupCut[] {
  const out: CleanupCut[] = [];
  for (const cut of [...cuts].sort((a, b) => a.start - b.start)) {
    const last = [...out].reverse().find(item => item.kind === cut.kind);
    if (last && cut.start <= last.end + .02) {
      last.end = Math.max(last.end, cut.end);
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
