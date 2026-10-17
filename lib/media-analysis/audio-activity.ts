import { transcriptFromWords, type Transcript } from './transcript';

export const AUDIO_ACTIVITY_VERSION = 1;
export const AUDIO_ACTIVITY_FRAME_SECONDS = .01;
export const AUDIO_QUIET_EDGE_PAD = .08;
export const MIN_AUDIO_QUIET_SECONDS = .2;
export const MAX_AUDIO_ACTIVITY_QUIET_INTERVALS = 5000;
export const MAX_AUDIO_ACTIVITY_DURATION = 86_400.5;

/** Measured low energy, not a speech detector or proof of the spoken content. */
export type AudioActivity = {
  version: typeof AUDIO_ACTIVITY_VERSION;
  duration: number;
  frameSeconds: typeof AUDIO_ACTIVITY_FRAME_SECONDS;
  quiet: { start: number; end: number }[];
  level: { noiseFloorDb: number; speechDb: number; quietThresholdDb: number; separationDb: number };
  reliable: boolean;
};
export type AudioEnergyFrames = { rmsDb: ArrayLike<number>; peakDb: ArrayLike<number> };

const roundTime = (value: number) => Math.round(value * 1e6) / 1e6;
const dbBucket = (db: number) => Math.max(0, Math.min(120, Math.round(Number.isFinite(db) ? db + 120 : 0)));

function percentile(histogram: Uint32Array, count: number, fraction: number) {
  const target = Math.max(1, Math.ceil(count * fraction));
  let accumulated = 0;
  for (let index = 0; index < histogram.length; index++) {
    accumulated += histogram[index];
    if (accumulated >= target) return index - 120;
  }
  return -120;
}

/** Calibrate the quiet floor to this recording and retain isolated consonant peaks. */
export function analyzeAudioActivity(frames: AudioEnergyFrames, duration: number, transcript?: Transcript): AudioActivity {
  const count = frames.rmsDb.length;
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_AUDIO_ACTIVITY_DURATION || !count || count > Math.ceil(MAX_AUDIO_ACTIVITY_DURATION / AUDIO_ACTIVITY_FRAME_SECONDS) || count !== frames.peakDb.length || Math.abs(count * AUDIO_ACTIVITY_FRAME_SECONDS - duration) > AUDIO_ACTIVITY_FRAME_SECONDS + 1e-6) throw new Error('Invalid audio activity frames.');
  const histogram = new Uint32Array(121), wordHistogram = new Uint32Array(121);
  for (let index = 0; index < count; index++) histogram[dbBucket(frames.rmsDb[index])]++;
  // Transcript windows provide a reference level, not evidence that every
  // provider-labelled sample contains speech. Refuse poorly separated levels.
  let wordFrames = 0, previousEnd = 0;
  for (const word of transcript?.words ?? []) {
    if (word.end <= word.start) continue;
    const start = Math.max(previousEnd, Math.ceil(word.start / AUDIO_ACTIVITY_FRAME_SECONDS));
    const end = Math.min(count, Math.floor(word.end / AUDIO_ACTIVITY_FRAME_SECONDS));
    for (let index = start; index < end; index++) { wordHistogram[dbBucket(frames.rmsDb[index])]++; wordFrames++; }
    previousEnd = Math.max(previousEnd, end);
  }
  const noiseFloorDb = percentile(histogram, count, .1);
  const speechDb = wordFrames ? percentile(wordHistogram, wordFrames, .9) : percentile(histogram, count, .9);
  const separationDb = Math.max(0, speechDb - noiseFloorDb);
  // Both a low absolute ceiling and the recording-relative limits matter:
  // quiet speech must not inherit the cutoff of a louder recording.
  const quietThresholdDb = Math.min(-48, noiseFloorDb + 16, speechDb - 24);
  const quiet: AudioActivity['quiet'] = [];
  let start = -1;
  const flush = (end: number) => {
    if (start < 0) return;
    const startTime = roundTime(start * AUDIO_ACTIVITY_FRAME_SECONDS), endTime = roundTime(Math.min(duration, end * AUDIO_ACTIVITY_FRAME_SECONDS));
    if (endTime - startTime >= MIN_AUDIO_QUIET_SECONDS - 1e-6) quiet.push({ start: startTime, end: endTime });
    start = -1;
  };
  for (let index = 0; index < count; index++) {
    if (frames.rmsDb[index] <= quietThresholdDb && frames.peakDb[index] <= quietThresholdDb + 8) {
      if (start < 0) start = index;
    } else flush(index);
  }
  flush(count);
  const reliable = separationDb >= 24 && speechDb > -110 && quiet.length <= MAX_AUDIO_ACTIVITY_QUIET_INTERVALS;
  return { version: AUDIO_ACTIVITY_VERSION, duration, frameSeconds: AUDIO_ACTIVITY_FRAME_SECONDS, quiet: quiet.slice(0, MAX_AUDIO_ACTIVITY_QUIET_INTERVALS), level: { noiseFloorDb, speechDb, quietThresholdDb, separationDb }, reliable };
}

/** Editing-only timing copy. Always persist the provider transcript unchanged. */
export function refineTranscriptWithAudioActivity(transcript: Transcript, activity: AudioActivity): Transcript {
  if (!activity.reliable || activity.version !== AUDIO_ACTIVITY_VERSION) return transcript;
  let changed = false;
  const words = transcript.words.map((word, index) => {
    if (word.end <= word.start) return word;
    const quiet = activity.quiet.find(interval => interval.start > word.start && interval.start < word.end && interval.end >= word.end && interval.end - interval.start >= MIN_AUDIO_QUIET_SECONDS - 1e-6);
    if (!quiet || quiet.start - word.start < .04 - 1e-6 || activity.quiet.some(interval => interval.start < quiet.start && interval.end > word.start)) return word;
    // A second provider word in the quiet interval makes ownership ambiguous.
    // Never shrink through overlapping or silent hallucinated word windows.
    if (transcript.words.some((other, otherIndex) => otherIndex !== index && other.start < quiet.end && other.end > quiet.start)) return word;
    const end = roundTime(quiet.start + AUDIO_QUIET_EDGE_PAD);
    if (end >= word.end || end <= word.start) return word;
    changed = true;
    return { ...word, end };
  });
  return changed ? transcriptFromWords(words, activity.duration) : transcript;
}

/** Trim only the requested range's outer measured quiet, keeping an audible pad. */
export function refineAudioRangeEdges(range: { start: number; end: number }, transcript: Transcript, activity: AudioActivity): { start: number; end: number } {
  if (!activity.reliable || activity.version !== AUDIO_ACTIVITY_VERSION || range.end <= range.start) return range;
  // Instantaneous provider alignments still make ownership ambiguous. Do not
  // skip them and trim against a different word's positive-duration evidence.
  const words = transcript.words.filter(word => word.start < range.end && (word.end > range.start || word.start === word.end && word.start >= range.start));
  if (!words.length) return range;
  const first = words[0], last = words[words.length - 1];
  let { start, end } = range;
  const leading = activity.quiet.find(quiet => quiet.start <= start + 1e-6 && quiet.end > start && quiet.end < Math.min(first.end, end) && quiet.end - start >= MIN_AUDIO_QUIET_SECONDS - 1e-6);
  if (leading && first.end > first.start && first.end - leading.end >= .04 - 1e-6 && !transcript.words.some(word => word !== first && word.start < leading.end && word.end > leading.start)) start = Math.max(start, Math.min(first.start, roundTime(leading.end - AUDIO_QUIET_EDGE_PAD)));
  const trailing = activity.quiet.find(quiet => quiet.start < end && quiet.end >= end - 1e-6 && end - quiet.start >= MIN_AUDIO_QUIET_SECONDS - 1e-6);
  if (trailing && last.end > last.start && trailing.start - last.start >= .04 - 1e-6 && !activity.quiet.some(quiet => quiet.start < trailing.start && quiet.end > last.start) && !transcript.words.some(word => word !== last && word.start < trailing.end && word.end > trailing.start)) end = Math.min(end, roundTime(trailing.start + AUDIO_QUIET_EDGE_PAD));
  return end > start && (start !== range.start || end !== range.end) ? { start, end } : range;
}
