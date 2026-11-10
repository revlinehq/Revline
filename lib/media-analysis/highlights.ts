import { z } from "zod";
import type { Transcript, TranscriptWord } from "./transcript";

// A v1 signal-only result is never accepted as a Gemini judgment.
export const HIGHLIGHT_VERSION = 3;
export const sourceTypes = [
  "podcast",
  "gaming",
  "irl",
  "sports",
  "talk",
] as const;
export const sourceType = z.enum(sourceTypes);
export type SourceType = z.infer<typeof sourceType>;
export const highlightSignal = z.object({
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  kind: z.enum(["spike", "silence"]),
  strength: z.number().min(0).max(1),
  detail: z.string().max(400),
});
export type HighlightSignal = z.infer<typeof highlightSignal>;
const line = z.object({
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  text: z.string().max(800),
});
export const semanticMoment = z.object({
  start: z.number().nonnegative(),
  end: z.number().positive(),
  kind: z.enum([
    "punchline",
    "story",
    "opinion",
    "quote",
    "question-answer",
    "action",
  ]),
  title: z.string().min(1).max(60),
  hook: line,
  payoff: line,
  reactionEnd: z.number().nonnegative(),
  score: z.number().min(0).max(100),
  reason: z.string().max(500),
});
export type SemanticMoment = z.infer<typeof semanticMoment>;
export const highlightJudgment = z.object({
  sourceType,
  typeReason: z.string().max(400),
  moments: z.array(semanticMoment).max(30),
  sceneCuts: z.array(z.number().nonnegative()).max(1500),
});
export type HighlightJudgment = z.infer<typeof highlightJudgment>;
export const highlightTracks = z.object({
  version: z.literal(HIGHLIGHT_VERSION),
  judge: z.enum(["gemini", "fallback"]),
  unavailableReason: z.string().max(1000).optional(),
  duration: z.number().positive().max(86400),
  sourceType,
  typeReason: z.string().max(400),
  levelStep: z.literal(0.5),
  levels: z.array(z.number().int()).max(172800),
  signals: z.array(highlightSignal).max(12000),
  moments: z.array(semanticMoment).max(1500),
  sceneCuts: z.array(z.number().nonnegative()).max(10000),
  warnings: z.array(z.string().max(500)).max(30),
  coverage: z.object({
    audioSeconds: z.number(),
    transcriptWords: z.number(),
    videoWindows: z
      .array(z.object({ start: z.number(), end: z.number() }))
      .max(100),
  }),
  elapsedMs: z.number(),
});
export type HighlightTracks = z.infer<typeof highlightTracks>;
export function readHighlights(value?: string): HighlightTracks | undefined {
  if (!value) return;
  const result = highlightTracks.safeParse(
    (() => {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    })(),
  );
  if (result.success) return result.data;
}
/** Marks a fallback that skipped Gemini on purpose: visual discovery measures audio and
 * scene cuts here and observes video only through targeted inspectVideo windows. */
export const HIGHLIGHT_SIGNALS_ONLY = 'Signals only: audio peaks and scene cuts for targeted visual discovery.';
/** Loud, compressed sources (trailers, music, action) rarely spike 7 dB over their rolling
 * median, so fall back to loudness onsets: a level at least 6 dB above the quietest of
 * the previous 3 s (drops, hits, re-entries). Cut helper only, strongest first. */
export function loudnessOnsets(levels: number[], step = 0.5, duration = levels.length * step): HighlightSignal[] {
  const lookback = Math.max(1, Math.round(3 / step)), onsets: HighlightSignal[] = [];
  for (let i = 1; i < levels.length; i++) {
    const floor = Math.min(...levels.slice(Math.max(0, i - lookback), i)), rise = levels[i] - floor;
    if (rise < 60 || levels[i] < -450) continue;
    const start = i * step, end = Math.min(duration, start + step), previous = onsets.at(-1);
    const strength = Math.min(1, rise / 200);
    if (previous && Math.abs(previous.end - start) < 0.01) { previous.end = end; previous.strength = Math.max(previous.strength, strength); continue; }
    onsets.push({ start, end, kind: 'spike', strength, detail: `RMS ${(levels[i] / 10).toFixed(1)} dB, ${(rise / 10).toFixed(1)} dB above the previous 3 s. Loudness onset; cut helper only.` });
  }
  return onsets.sort((a, b) => b.strength - a.strength);
}
/** Spoken-content discovery needs only existing word timings, never a media job. */
export function transcriptHighlightTracks(duration: number, transcript: Transcript | undefined, type: SourceType = 'talk', requireWords = true): HighlightTracks {
  if (requireWords && !transcript?.words.length) throw new Error('Transcribe the source before transcript-first clipping.');
  return { version: HIGHLIGHT_VERSION, judge: 'fallback', duration, sourceType: type,
    typeReason: 'Spoken-content request: select moments from the saved transcript.',
    levelStep: 0.5, levels: [], signals: [], moments: [], sceneCuts: [], warnings: [],
    coverage: { audioSeconds: 0, transcriptWords: transcript?.words.length ?? 0, videoWindows: [] }, elapsedMs: 0 };
}
export const HIGHLIGHT_QUALITY_BAR = 65;

export const round = (n: number) => Math.round(n * 1000) / 1000;
const sentenceEnd = (w: TranscriptWord) => /[.!?]["'”’)]*$/.test(w.text);
export const thoughtStart = (words: TranscriptWord[], i: number) =>
  i === 0 ||
  sentenceEnd(words[i - 1]) ||
  words[i].start - words[i - 1].end >= 0.45;

/** Preserve Gemini's payoff/reaction; words and RMS pauses refine the cut only. */
export function cleanHighlightRange(
  moment: Pick<SemanticMoment, "start" | "end" | "hook" | "payoff" | "reactionEnd">,
  transcript: Transcript | undefined,
  signals: HighlightSignal[],
  duration: number,
) {
  const words = transcript?.words ?? [];
  const target = Math.max(moment.end, moment.payoff.end, moment.reactionEnd);
  if (
    !words.length ||
    !words.some((w) => w.start <= moment.start + 2 && w.end >= moment.start - 2)
  ) {
    const start = Math.max(0, Math.min(moment.start, target - 15));
    const quiet = signals.find(
      (s) =>
        s.kind === "silence" &&
        s.end >= target + 0.08 &&
        s.start <= target + 3 &&
        s.end <= start + 60,
    );
    return {
      start: round(start),
      end: round(
        Math.min(
          duration,
          quiet ? Math.max(target + 0.08, quiet.start + 0.08) : target,
        ),
      ),
    };
  }
  const first = words.findIndex((w) => w.end > moment.start);
  if (first < 0) return { start: moment.start, end: target };
  const latestStart = Math.min(moment.start + 0.45, moment.hook.start + 0.1);
  const starts = words
    .map((w, i) => ({ w, i }))
    .filter(
      ({ w, i }) =>
        i <= first &&
        w.start <= latestStart &&
        w.start >= moment.start - 12 &&
        thoughtStart(words, i) &&
        !words
          .slice(Math.max(0, i - 30), i)
          .some((previous) => previous.end > w.start + 0.025),
    )
    .reverse()
    .map(({ w }) => w.start);
  // A visual hook can start in a speech pause. Never move it forward to a
  // later, unrelated sentence merely because that is the next timed word.
  // Crosstalk can leave no clean thought start at all; the moment's own start
  // is then the only in point to refine from.
  if (words[first].start > latestStart || !starts.length)
    starts.unshift(moment.start);
  // First pass: a sentence end or a long pause. Second pass: any word-timed
  // pause of 0.25 s, the same gap the finish boundary check accepts.
  for (const relaxed of [false, true])
    for (const start of starts) {
      for (let i = first; i < words.length; i++) {
        const word = words[i],
          next = words[i + 1],
          pauseEnd = next?.start ?? duration;
        // The cursor must lie after ALL overlapping speaker words, and inside
        // a measured pause, never in an 80ms pad borrowed from the prior word.
        const spokenEnd = Math.max(
          word.end,
          ...words.slice(Math.max(0, i - 30), i).map((w) => w.end),
        );
        const end = Math.max(target + 0.08, spokenEnd + 0.08, start + 15);
        const pause = pauseEnd - spokenEnd;
        if (end > start + 60 || spokenEnd > start + 60) break;
        if (
          end <= pauseEnd - 0.03 &&
          pause >= 0.25 &&
          (relaxed || sentenceEnd(word) || pause >= 0.6) &&
          end >= target
        )
          return { start: round(start), end: round(Math.min(duration, end)) };
        if (
          !next &&
          duration >= target &&
          duration - start >= 15 &&
          duration - start <= 60
        )
          return { start: round(start), end: round(duration) };
      }
    }
  // No word-timed pause follows the payoff within 60 s. Suggest the moment's
  // own range, moved past any word the payoff end would cut when that still
  // fits in 60 s: it qualifies when it is 15-60 s, and finishClipping checks
  // the built tab's actual in/out points against the words. The earlier
  // fallback pushed the end to start + 60.001 s, which disqualified every
  // such moment.
  const start = Math.max(0, Math.min(moment.start, words[first].start));
  const at = words.findIndex((w) => w.end >= target);
  const spokenEnd = at < 0 ? target : Math.max(
    words[at].end,
    ...words.slice(Math.max(0, at - 30), at).map((w) => w.end),
  );
  const wordEnd = Math.max(target + 0.08, spokenEnd + 0.08);
  return {
    start: round(start),
    end: round(Math.min(duration, wordEnd <= start + 60 ? wordEnd : target)),
  };
}

export function rankHighlights(
  tracks: HighlightTracks,
  transcript?: Transcript,
  type = tracks.sourceType,
) {
  const ranked = tracks.moments
    .flatMap((moment) => {
      const range = cleanHighlightRange(
        moment,
        transcript,
        tracks.signals,
        tracks.duration,
      );
      const invalidRange =
        range.end - range.start < 15 ||
        range.end - range.start > 60 ||
        moment.hook.start < range.start - 0.1 ||
        moment.payoff.end > range.end ||
        moment.reactionEnd > range.end;
      return [
        {
          id:
            "H" +
            Math.round(moment.payoff.start * 1000) +
            "-" +
            Math.round(range.start * 1000),
          title: moment.title,
          ...range,
          duration: round(range.end - range.start),
          score: Math.round(moment.score),
          qualified: !invalidRange && moment.score >= HIGHLIGHT_QUALITY_BAR,
          sourceType: type,
          kind: moment.kind,
          quote: moment.payoff.text,
          hook: moment.hook,
          payoff: moment.payoff,
          reactionEnd: moment.reactionEnd,
          cleanIn: range.start,
          cleanOut: range.end,
          reason: invalidRange
            ? `${moment.reason} Not qualified: a clean 15-60s range could not preserve the hook, payoff and reaction.`
            : moment.reason,
          evidence: [
            {
              start: moment.start,
              end: moment.end,
              kind: tracks.judge === "gemini" ? "gemini" : "transcript-audio",
              strength: moment.score / 100,
              detail: moment.reason,
            },
            ...tracks.signals.filter(
              (s) => s.start < range.end && s.end >= range.start,
            ),
          ],
        },
      ];
    })
    .sort((a, b) => Number(b.qualified) - Number(a.qualified) || b.score - a.score || a.start - b.start);
  const distinct: typeof ranked = [];
  for (const item of ranked)
    if (
      !distinct.some(
        (other) =>
          Math.max(
            0,
            Math.min(item.end, other.end) - Math.max(item.start, other.start),
          ) /
            Math.min(item.duration, other.duration) >
          0.45,
      )
    )
      distinct.push(item);
  return distinct.slice(0, 80);
}
export function defaultClipCount(duration: number, qualified: number) {
  return Math.min(10, qualified, Math.max(3, Math.round(duration / 150)));
}
