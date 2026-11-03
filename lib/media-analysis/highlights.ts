import { z } from "zod";
import type { Transcript, TranscriptWord } from "./transcript";

export const HIGHLIGHT_VERSION = 1;
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
  kind: z.enum([
    "spike",
    "silence",
    "build",
    "laughter",
    "shouting",
    "cheering",
    "applause",
    "music",
    "chat",
    "reaction",
    "exchange",
    "overlap",
    "cut",
    "topic",
  ]),
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
  strength: z.number().min(0).max(1),
  reason: z.string().max(500),
});
export type SemanticMoment = z.infer<typeof semanticMoment>;
export const highlightTracks = z.object({
  version: z.literal(HIGHLIGHT_VERSION),
  duration: z.number().positive().max(86400),
  sourceType,
  typeReason: z.string().max(400),
  // Half-second dB RMS values, quantized to tenths; compact enough for a 3 h cache.
  levelStep: z.literal(0.5),
  levels: z.array(z.number().int()).max(172800),
  signals: z.array(highlightSignal).max(12000),
  moments: z.array(semanticMoment).max(1000),
  warnings: z.array(z.string().max(500)).max(30),
  coverage: z.object({
    audioSeconds: z.number(),
    transcriptSeconds: z.number(),
    textChunks: z.number(),
    visualSeconds: z.number(),
    chat: z.string(),
  }),
  elapsedMs: z.number(),
});
export type HighlightTracks = z.infer<typeof highlightTracks>;
export function readHighlights(value?: string): HighlightTracks | undefined {
  if (!value) return;
  try {
    return highlightTracks.parse(JSON.parse(value));
  } catch {
    return;
  }
}

// Signal families sum to one. Missing optional signals cannot inflate a score.
export const highlightWeights: Record<
  SourceType,
  {
    text: number;
    audio: number;
    events: number;
    chat: number;
    reaction: number;
    exchange: number;
  }
> = {
  podcast: {
    text: 0.6,
    audio: 0.07,
    events: 0.16,
    chat: 0.03,
    reaction: 0.04,
    exchange: 0.1,
  },
  gaming: {
    text: 0.3,
    audio: 0.17,
    events: 0.19,
    chat: 0.2,
    reaction: 0.12,
    exchange: 0.02,
  },
  irl: {
    text: 0.44,
    audio: 0.12,
    events: 0.17,
    chat: 0.13,
    reaction: 0.1,
    exchange: 0.04,
  },
  sports: {
    text: 0.25,
    audio: 0.2,
    events: 0.25,
    chat: 0.18,
    reaction: 0.09,
    exchange: 0.03,
  },
  talk: {
    text: 0.67,
    audio: 0.08,
    events: 0.12,
    chat: 0.03,
    reaction: 0.03,
    exchange: 0.07,
  },
};
export const HIGHLIGHT_QUALITY_BAR = 55;
const round = (n: number) => Math.round(n * 1000) / 1000;
const sentenceEnd = (w: TranscriptWord) => /[.!?]["'”’)]*$/.test(w.text);
export const thoughtStart = (words: TranscriptWord[], i: number) =>
  i === 0 ||
  sentenceEnd(words[i - 1]) ||
  words[i].start - words[i - 1].end >= 0.45;

/** Extend to complete thoughts and measured reactions. Never trim a payoff to fit. */
export function cleanHighlightRange(
  moment: Pick<SemanticMoment, "start" | "end" | "payoff">,
  transcript: Transcript | undefined,
  signals: HighlightSignal[],
  duration: number,
) {
  const words = transcript?.words ?? [];
  let target = Math.max(moment.end, moment.payoff.end);
  for (const event of signals
    .filter(
      (s) =>
        ["laughter", "shouting", "cheering", "applause", "reaction"].includes(
          s.kind,
        ) && s.strength >= 0.35,
    )
    .sort((a, b) => a.start - b.start))
    if (event.start >= moment.payoff.start && event.start <= target + 1.5)
      target = Math.max(target, event.end);
  if (!words.length)
    return {
      start: round(Math.max(0, Math.min(moment.start, target - 15))),
      end: round(Math.min(duration, target + 0.2)),
    };
  const first = words.findIndex((w) => w.end > moment.start);
  if (first < 0) return { start: moment.start, end: target };
  const starts = words
    .map((w, i) => ({ w, i }))
    .filter(
      ({ w, i }) =>
        i <= first &&
        w.start >= moment.start - 12 &&
        thoughtStart(words, i) &&
        !words
          .slice(Math.max(0, i - 30), i)
          .some((previous) => previous.end > w.start + 0.025),
    )
    .reverse();
  for (const { w: begin } of starts) {
    const start = begin.start;
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
  const weights = { ...highlightWeights[type] };
  // Renormalize for absent optional modalities at SOURCE level, never per
  // candidate: a podcast without chat should not lose points for that absence.
  if (!/^(available|partial)/.test(tracks.coverage.chat)) weights.chat = 0;
  if (!tracks.signals.some((s) => s.kind === "reaction")) weights.reaction = 0;
  if (!transcript?.words.some((w) => w.speaker !== undefined))
    weights.exchange = 0;
  const availableWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  for (const key of Object.keys(weights) as (keyof typeof weights)[])
    weights[key] /= availableWeight;
  const seeds: SemanticMoment[] = [...tracks.moments];
  // Non-verbal moments remain discoverable, but peaks alone never pass the bar.
  for (const event of tracks.signals.filter(
    (s) =>
      ["laughter", "shouting", "cheering", "applause", "chat"].includes(
        s.kind,
      ) && s.strength >= 0.45,
  )) {
    if (
      seeds.some((m) => event.start >= m.start - 5 && event.start <= m.end + 3)
    )
      continue;
    const words =
      transcript?.words.filter(
        (w) => w.start >= event.start - 18 && w.end <= event.end,
      ) ?? [];
    const hookWords = words.slice(0, 12),
      payoffWords = words.slice(-18);
    const toLine = (list: TranscriptWord[]) => ({
      start: list[0]?.start ?? event.start,
      end: list.at(-1)?.end ?? event.end,
      text: list.map((w) => w.text).join(" "),
    });
    seeds.push({
      start: Math.max(0, event.start - 15),
      end: event.end + 0.5,
      kind: "action",
      title: `${event.kind} at ${Math.floor(event.start)}s`,
      hook: toLine(hookWords),
      payoff: toLine(payoffWords),
      strength: 0,
      reason: "Audio/audience candidate; its meaning needs editorial review.",
    });
  }
  const ranked = seeds
    .flatMap((moment) => {
      const range = cleanHighlightRange(
        moment,
        transcript,
        tracks.signals,
        tracks.duration,
      );
      if (
        range.end - range.start < 15 ||
        range.end - range.start > 60 ||
        moment.payoff.end > range.end
      )
        return [];
      const evidence = tracks.signals.filter(
        (s) => s.start < range.end && s.end >= range.start && s.kind !== "cut",
      );
      const strongest = (kinds: string[]) =>
        Math.max(
          0,
          ...evidence
            .filter((s) => kinds.includes(s.kind))
            .map((s) => s.strength),
        );
      const values = {
        text: moment.strength,
        audio: strongest(["spike", "silence", "build"]),
        events: strongest([
          "laughter",
          "shouting",
          "cheering",
          "applause",
          "music",
        ]),
        chat: strongest(["chat"]),
        reaction: strongest(["reaction"]),
        exchange: strongest(["exchange", "overlap"]),
      };
      // A strong text-only quote can qualify on a quiet podcast. Corroborating
      // signals add confidence, while two non-verbal families are needed otherwise.
      const fused = Object.entries(weights).reduce(
        (sum, [key, weight]) =>
          sum + values[key as keyof typeof values] * weight,
        0,
      );
      const score = Math.round(
        100 * Math.min(1, fused + (moment.strength >= 0.65 ? 0.18 : 0)),
      );
      const strongFamilies = Object.values(values).filter(
        (v) => v >= 0.5,
      ).length;
      const qualified =
        score >= HIGHLIGHT_QUALITY_BAR &&
        (moment.strength >= 0.65 || strongFamilies >= 2);
      return [
        {
          id: `H${Math.round(moment.payoff.start * 1000)}-${Math.round(range.start * 1000)}`,
          title: moment.title,
          ...range,
          duration: round(range.end - range.start),
          score,
          qualified,
          sourceType: type,
          kind: moment.kind,
          quote: moment.payoff.text,
          hook: moment.hook,
          payoff: moment.payoff,
          cleanIn: range.start,
          cleanOut: range.end,
          reason: moment.reason,
          evidence: [
            {
              start: moment.start,
              end: moment.end,
              kind: "transcript",
              strength: moment.strength,
              detail: moment.reason,
            },
            ...evidence,
          ],
          signals: values,
        },
      ];
    })
    .sort((a, b) => b.score - a.score || a.start - b.start);
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

/** Diarization measures pace/overlap; it never names speakers or proves emotion. */
export function exchangeSignals(transcript?: Transcript): HighlightSignal[] {
  if (!transcript) return [];
  const turns: { start: number; end: number; speaker: number }[] = [];
  for (const w of transcript.words) {
    if (w.speaker === undefined) continue;
    const last = turns.at(-1);
    if (last?.speaker === w.speaker && w.start - last.end < 1)
      last.end = Math.max(last.end, w.end);
    else turns.push({ start: w.start, end: w.end, speaker: w.speaker });
  }
  const result: HighlightSignal[] = [];
  for (let i = 1; i < turns.length; i++) {
    const a = turns[i - 1],
      b = turns[i];
    if (b.start < a.end - 0.05)
      result.push({
        start: b.start,
        end: Math.min(a.end, b.end),
        kind: "overlap",
        strength: Math.min(1, (a.end - b.start) / 1.5),
        detail: `Speakers ${a.speaker}/${b.speaker} overlap`,
      });
    const recent = turns.slice(Math.max(0, i - 5), i + 1);
    if (
      recent.length >= 4 &&
      b.end - recent[0].start <= 12 &&
      b.start - a.end < 0.4
    )
      result.push({
        start: recent[0].start,
        end: b.end,
        kind: "exchange",
        strength: Math.min(1, recent.length / 6),
        detail: `${recent.length} diarized turns within ${round(b.end - recent[0].start)}s`,
      });
  }
  return result;
}
