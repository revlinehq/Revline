import { trackSourceFace } from "./track-source-face";
import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { locateFacecam, locateSpeakingFaces } from "../media-analysis/gemini";
import {
  facecamAnalysis,
  speakerAnalysis,
  speakerFocus,
  type SpeakerAnalysis,
} from "../media-analysis/clipping";
import { extractVideoWindow } from "../media-analysis/io";
import type { Transcript } from "../media-analysis/transcript";
import { AnalysisError } from "../media-analysis/errors";

const run = promisify(execFile);
export async function detectSourceFacecam(
  source: string,
  directory: string,
  duration: number,
  key: string,
  signal: AbortSignal,
  progress: (n: number) => void,
) {
  const count = Math.min(80, Math.max(1, Math.ceil(duration / 30))),
    samples = [];
  for (let first = 0; first < count; first += 8) {
    const images = [];
    for (let i = first; i < Math.min(count, first + 8); i++) {
      const time = Math.min(
          Math.max(0, duration - 0.05),
          (i * duration) / count,
        ),
        path = join(directory, "facecam.jpg");
      await run(
        "ffmpeg",
        [
          "-v",
          "error",
          "-ss",
          String(time),
          "-i",
          source,
          "-frames:v",
          "1",
          "-q:v",
          "2",
          "-y",
          path,
        ],
        { signal, maxBuffer: 1024 * 1024 },
      );
      images.push({ time, data: (await readFile(path)).toString("base64") });
      await rm(path, { force: true });
    }
    samples.push(...(await locateFacecam(images, key, signal)));
    progress(15 + (80 * Math.min(count, first + 8)) / count);
  }
  return facecamAnalysis.parse({ version: 1, samples });
}

export async function trackSourceSpeakers(
  source: string,
  directory: string,
  duration: number,
  transcript: Transcript,
  key: string,
  signal: AbortSignal,
  progress: (n: number) => void,
): Promise<SpeakerAnalysis> {
  const words = transcript.words;
  if (!words.length)
    return {
      version: 1,
      start: 0,
      end: duration,
      identityScope: "window",
      turns: [],
      focus: [],
    };
  if (words.some((w) => w.speaker === undefined))
    throw new AnalysisError(
      "Speaker diarization is unavailable. Run transcription with diarization on the updated worker.",
      422,
    );
  const turns: {
    start: number;
    end: number;
    speaker: number;
    text: string;
    confidence: number;
  }[] = [];
  for (const word of words) {
    if (word.speaker === undefined) continue;
    const previous = turns.at(-1),
      confidence = word.speakerConfidence ?? 0;
    if (
      previous &&
      previous.speaker === word.speaker &&
      word.start - previous.end < 0.7 &&
      word.end - previous.start < 12
    ) {
      previous.end = Math.max(previous.end, word.end);
      previous.text += ` ${word.text}`;
      previous.confidence = Math.min(previous.confidence, confidence);
    } else if (word.end > word.start)
      turns.push({
        start: word.start,
        end: word.end,
        speaker: word.speaker,
        text: word.text,
        confidence,
      });
  }
  if (turns.length > 2000)
    throw new AnalysisError(
      "Speaker analysis supports up to 2,000 turns. Use a shorter source.",
      400,
    );
  const located: SpeakerAnalysis["turns"] = [];
  // Only upload windows containing speech. Bounded video windows retain the original audio alignment.
  for (let first = 0; first < turns.length;) {
    const start = turns[first].start,
      end = Math.min(duration, start + 60),
      batch = [];
    while (first < turns.length && turns[first].start < end) {
      const turn = turns[first++];
      batch.push({ ...turn, end: Math.min(turn.end, end) });
      if (turn.end > end) {
        turns.splice(first, 0, { ...turn, start: end });
      }
    }
    const window = join(directory, "speaker-window.mp4");
    await extractVideoWindow(source, window, start, end, signal);
    const result = await locateSpeakingFaces(
      window,
      batch.map((t) => ({ ...t, start: t.start - start, end: t.end - start })),
      end - start,
      key,
      signal,
    );
    located.push(
      ...result.map((t) => ({
        ...t,
        start: t.start + start,
        end: t.end + start,
      })),
    );
    await rm(window, { force: true });
    progress(20 + (75 * first) / turns.length);
  }
  const anchors = located.flatMap((t) =>
    t.face && t.confidence >= 0.7
      ? [
          {
            start: t.start,
            end: t.end,
            speaker: t.speaker,
            x: t.face.x + t.face.w / 2,
            y: t.face.y + t.face.h / 2,
          },
        ]
      : [],
  );
  const tracked = anchors.length
    ? await trackSourceFace(
        source,
        duration,
        (n) => progress(95 + n * 0.04),
        signal,
        anchors,
      )
    : [];
  return speakerAnalysis.parse({
    version: 1,
    start: 0,
    end: duration,
    identityScope: "window",
    turns: located,
    focus: speakerFocus(located, duration, tracked),
  });
}
