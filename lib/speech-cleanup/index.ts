import { acousticCuts } from './acoustic';
import { analyzeFrames } from './frames';
import { fillerWordCuts, restartCuts } from './restarts';
import { DEFAULT_CLEANUP_OPTIONS, SPEECH_CLEANUP_VERSION, type CleanupCut, type CleanupOptions, type SpeechWord } from './types';

export * from './types';
export { analyzeFrames } from './frames';

/**
 * Speech cleanup engine: finds what to cut from a talking recording, in three layers.
 * 1. Filler words a verbatim transcript kept ("um", "uh").
 * 2. Acoustic gaps and stretched words: pauses, breaths and held fillers measured in 10ms frames,
 *    which catches what a clean-text transcriber leaves out of its words.
 * 3. Restarts: repeated phrases, keeping only the final take.
 * Returns merged, time-ordered cuts in SOURCE seconds; nothing here edits a timeline.
 */
export function findSpeechCleanup(words: SpeechWord[], samples: Float32Array, sampleRate: number, options: Partial<CleanupOptions> = {}): CleanupCut[] {
  const settings = { ...DEFAULT_CLEANUP_OPTIONS, ...options };
  const sorted = [...words].sort((a, b) => a.start - b.start);
  const frames = analyzeFrames(samples, sampleRate);
  return mergeCuts([...fillerWordCuts(sorted), ...restartCuts(sorted, settings), ...acousticCuts(sorted, frames, settings)]);
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
