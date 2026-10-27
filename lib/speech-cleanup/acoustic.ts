import { frameAt, timeAt, type Frames } from './frames';
import type { CleanupCut, CleanupOptions, SpeechWord } from './types';

type FrameClass = 'silence' | 'breath' | 'hold' | 'speech';

/** The recording's own levels: quiet floor and typical speech, from loudness percentiles. */
function levels(frames: Frames) {
  const sorted = Array.from(frames.db).filter(Number.isFinite).sort((a, b) => a - b);
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? -90;
  const floor = at(.1), speech = at(.9);
  // Silence sits near the floor; with a noisy room never above the midpoint to speech.
  return { floor, speech, silence: Math.min(floor + 8, (floor + speech) / 2) };
}

/** Labels each 10ms frame. Breath is audible but unpitched and hissy; a hold is a steady pitched
 * sound ("uhhh", "mmm") whose spectrum barely changes; anything else audible counts as speech. */
function classify(frames: Frames): FrameClass[] {
  const { silence } = levels(frames);
  const out: FrameClass[] = new Array(frames.count);
  for (let i = 0; i < frames.count; i++) {
    if (frames.db[i] < silence) { out[i] = 'silence'; continue; }
    if (frames.voicing[i] < .45) { out[i] = frames.zcr[i] > .06 || frames.db[i] < silence + 10 ? 'breath' : 'speech'; continue; }
    // A held vowel: pitched, spectrum stable, pitch steady against both neighbours.
    const p = frames.pitch[i], before = frames.pitch[i - 1] ?? 0, after = frames.pitch[i + 1] ?? 0;
    const steady = p > 0 && before > 0 && after > 0 && Math.abs(before - p) / p < .04 && Math.abs(after - p) / p < .04;
    out[i] = steady && frames.flux[i] < .12 ? 'hold' : 'speech';
  }
  return out;
}

type Run = { kind: FrameClass; from: number; to: number };
function runs(labels: FrameClass[], from: number, to: number): Run[] {
  const out: Run[] = [];
  for (let i = Math.max(0, from); i < Math.min(labels.length, to); i++) {
    const last = out[out.length - 1];
    if (last && last.kind === labels[i] && last.to === i) last.to = i + 1;
    else out.push({ kind: labels[i], from: i, to: i + 1 });
  }
  return out;
}

/** Short gaps inside a run of the same kind (a 20ms blip) do not split it. */
function smooth(list: Run[], kind: FrameClass, bridge = 3) {
  const out: Run[] = [];
  for (const run of list) {
    const last = out[out.length - 1];
    if (run.kind === kind && last?.kind === kind && run.from - last.to <= bridge) last.to = run.to;
    else if (run.kind === kind) out.push({ ...run });
  }
  return out;
}

const KIND_LABEL = { silence: 'pause', breath: 'breath', hold: 'filler' } as const;

/** Acoustic cuts: non-speech between words, and fillers or pauses hidden inside words whose
 * timestamps a clean-text transcriber stretched over them. */
export function acousticCuts(words: SpeechWord[], frames: Frames, options: CleanupOptions): CleanupCut[] {
  const labels = classify(frames), cuts: CleanupCut[] = [];
  const pad = frameAt(options.pad);
  const push = (kind: CleanupCut['kind'], from: number, to: number, confidence: number, detail: string) => {
    const start = timeAt(from + pad), end = timeAt(to - pad);
    if (end - start >= .08) cuts.push({ kind, start, end, confidence, detail });
  };
  // 1. Gaps between consecutive words.
  for (let index = 0; index + 1 < words.length; index++) {
    const from = frameAt(words[index].end), to = frameAt(words[index + 1].start);
    if (to - from < frameAt(.12)) continue;
    const parts = runs(labels, from, to), total = to - from;
    const frames = (kinds: FrameClass[]) => parts.filter(run => kinds.includes(run.kind)).reduce((sum, run) => sum + run.to - run.from, 0);
    // A clean-text transcriber keeps real words and drops "um"/"uh": voiced sound where it has no
    // word is a hesitation. Over a second of it may be a missed word, so that is left alone.
    const voiced = frames(['speech', 'hold']), breath = frames(['breath']);
    if (timeAt(voiced) > 1) continue;
    const kind = voiced >= frameAt(.12) ? 'filler' : breath > total * .3 ? 'breath' : 'pause';
    if (kind === 'pause' && timeAt(total) < options.minPause) continue;
    const confidence = kind === 'filler' ? .7 : Math.min(1, .55 + .45 * (1 - (voiced + breath) / total));
    push(kind, from, to, confidence, kind === 'filler' ? `${timeAt(voiced).toFixed(2)}s voiced sound with no word` : kind === 'breath' ? 'breath between words' : `${timeAt(total).toFixed(2)}s pause`);
  }
  // 2. Words much longer than their letters allow: look for held sounds, breaths or silence inside.
  for (const word of words) {
    const letters = word.text.replace(/[^a-z0-9']/gi, '').length;
    const expected = .12 + .075 * letters;
    if (word.end - word.start < expected + .35) continue;
    for (const kind of ['hold', 'breath', 'silence'] as const) {
      for (const run of smooth(runs(labels, frameAt(word.start), frameAt(word.end)), kind)) {
        if (timeAt(run.to - run.from) < (kind === 'silence' ? options.minPause : .22)) continue;
        push(KIND_LABEL[kind], run.from, run.to, .6, `${KIND_LABEL[kind]} inside "${word.text}"`);
      }
    }
  }
  return cuts;
}
