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
/** Spoken-content discovery needs only existing word timings, never a media job. */
export function transcriptHighlightTracks(duration: number, transcript: Transcript | undefined, type: SourceType = 'talk', requireWords = true): HighlightTracks {
  if (requireWords && !transcript?.words.length) throw new Error('Transcribe the source before transcript-first clipping.');
  return { version: HIGHLIGHT_VERSION, judge: 'fallback', duration, sourceType: type,
    typeReason: 'Spoken-content request: select moments from the saved transcript.',
    levelStep: 0.5, levels: [], signals: [], moments: [], sceneCuts: [], warnings: [],
    coverage: { audioSeconds: 0, transcriptWords: transcript?.words.length ?? 0, videoWindows: [] }, elapsedMs: 0 };
}
export const HIGHLIGHT_QUALITY_BAR = 65;

const round = (n: number) => Math.round(n * 1000) / 1000;
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
  if (words[first].start > latestStart)
    starts.unshift(moment.start);
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
        (sentenceEnd(word) || pause >= 0.6) &&
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
  // No complete thought + payoff + pause fits. Returning an overlong range
  // keeps it out of the ranked 15-60s candidates instead of truncating words.
  return {
    start: Math.max(0, words[first].start),
    end: Math.max(target, words[first].start + 60.001),
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
