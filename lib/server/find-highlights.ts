import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { AnalysisError } from "../media-analysis/errors";
import { findVideoHighlights } from "../media-analysis/gemini";
import {
  extractVideoWindow,
  needsAnalysisVideoProxy,
  prepareVideo,
  probeMedia,
} from "../media-analysis/io";
import {
  highlightJudgment,
  highlightTracks,
  type HighlightJudgment,
  type HighlightTracks,
  type SourceType,
} from "../media-analysis/highlights";
import type { Transcript } from "../media-analysis/transcript";
import type { ReportMediaActivity } from "../media-analysis/activity";
import { forEachLimited } from "./run-limited";
import { reuseMediaFile } from "./media-file-cache";
import { highlightAudio } from "./highlight-audio";
import type { FrameCache } from "./frame-cache";

const WINDOW = 1800,
  OVERLAP = 60;
export const highlightWindows = (duration: number) =>
  Array.from({ length: Math.ceil(duration / WINDOW) }, (_, i) => ({
    start: i * WINDOW,
    end: Math.min(duration, (i + 1) * WINDOW + OVERLAP),
  }));
function transcriptWindow(
  transcript: Transcript | undefined,
  start: number,
  end: number,
) {
  const words =
      transcript?.words.filter((w) => w.end >= start && w.start < end) ?? [],
    lines: string[] = [];
  for (let i = 0; i < words.length; i += 16) {
    const group = words.slice(i, i + 16);
    lines.push(
      "[" +
        Math.max(0, group[0].start - start).toFixed(2) +
        "-" +
        Math.min(end - start, group.at(-1)!.end - start).toFixed(2) +
        "] " +
        group.map((w) => "S" + (w.speaker ?? "?") + ":" + w.text).join(" "),
    );
  }
  return (
    lines.join("\n") ||
    "No timed transcript available; judge the video and sound directly."
  );
}

/** Gemini watches every source window. Transcript/RMS are helpers, never a substitute judge. */
export async function findSourceHighlights(
  input: {
    source: string;
    duration: number;
    video: boolean;
    transcript?: Transcript;
    sourceType?: SourceType;
    cacheIdentity?: string;
    cache?: FrameCache;
    geminiUnavailableReason?: string;
    sceneCuts?: number[];
  },
  signal: AbortSignal,
  progress: (n: number) => void,
  onActivity?: ReportMediaActivity,
): Promise<HighlightTracks> {
  if (!input.video)
    throw new AnalysisError(
      "Highlight discovery requires source video for Gemini to watch.",
      400,
      false,
    );
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const started = Date.now(),
    directory = await mkdtemp(join(tmpdir(), "revline-highlights-"));
  try {
    const measured = await probeMedia(input.source, signal);
    if (input.duration - measured.duration > 2)
      throw new AnalysisError(
        "The source video is incomplete. Whole-source highlight discovery cannot continue.",
        422,
        false,
      );
    const audio = await highlightAudio(
      input.source,
      input.duration,
      directory,
      signal,
    );
    const fallback = (reason: string) =>
      highlightTracks.parse({
        version: 3,
        judge: "fallback",
        unavailableReason: reason.slice(0, 1000),
        duration: input.duration,
        sourceType: input.sourceType ?? "talk",
        typeReason: input.sourceType
          ? "User-provided type."
          : "Fallback: infer type while reading the transcript and source frames.",
        levelStep: 0.5,
        ...audio,
        moments: [],
        sceneCuts: input.sceneCuts ?? [],
        warnings: [
          "Gemini unavailable. Pick moments from the transcript, audio helpers, scene cuts and targeted readFrames, then register them with planClips found.",
        ],
        coverage: {
          audioSeconds: audio.audioSeconds,
          transcriptWords: input.transcript?.words.length ?? 0,
          videoWindows: [],
        },
        elapsedMs: Date.now() - started,
      });
    if (input.geminiUnavailableReason || !key)
      return fallback(
        input.geminiUnavailableReason ?? "Gemini is not configured.",
      );
    progress(15);
    const windows = highlightWindows(input.duration),
      judgments: HighlightJudgment[] = new Array(windows.length);
    let complete = 0;
    try {
      await forEachLimited(windows, 2, async (window, stop) => {
        const active = AbortSignal.any([signal, stop]),
          localDuration = window.end - window.start;
        const transcript = transcriptWindow(
          input.transcript,
          window.start,
          window.end,
        );
        const peaks = audio.signals
          .filter(
            (s) =>
              s.kind === "spike" &&
              s.start < window.end &&
              s.end >= window.start,
          )
          .sort((a, b) => b.strength - a.strength)
          .slice(0, 40)
          .map((s) => ({
            start: Math.max(0, s.start - window.start),
            end: Math.min(localDuration, s.end - window.start),
          }));
        const produce = async () => {
          let video = input.source;
          if (windows.length > 1) {
            video = join(directory, "window-" + window.start + ".mp4");
            await reuseMediaFile(
              {
                identity: input.cacheIdentity,
                variant:
                  "highlight-window-v2:" + window.start + ":" + window.end,
                target: video,
                signal: active,
              },
              () =>
                extractVideoWindow(
                  input.source,
                  video,
                  window.start,
                  window.end,
                  active,
                ),
            );
          } else {
            const bytes = (await stat(input.source)).size;
            if (
              needsAnalysisVideoProxy(
                { size: bytes },
                input.duration,
                "overview",
              )
            ) {
              video = join(directory, "overview.mp4");
              await reuseMediaFile(
                {
                  identity: input.cacheIdentity,
                  variant: "analysis-overview-v1",
                  target: video,
                  signal: active,
                  maxBytes: bytes - 1,
                },
                () => prepareVideo(input.source, video, active, "overview"),
              );
              if ((await stat(video)).size >= bytes) video = input.source;
            }
          }
          const actual = await probeMedia(video, active);
          if (localDuration - actual.duration > 2)
            throw new AnalysisError(
              "A Gemini highlight window is incomplete. No partial ranking was accepted.",
              422,
              false,
            );
          return findVideoHighlights(
            video,
            Math.min(localDuration, actual.duration),
            {
              transcript,
              peaks,
              sourceType: input.sourceType,
              sourceOffset: window.start,
            },
            key,
            active,
            "video/mp4",
            onActivity,
          );
        };
        const helperKey = createHash("sha256")
          .update(JSON.stringify({ transcript, peaks }))
          .digest("hex");
        const descriptor = {
          kind: "highlight-judgment",
          version: 3,
          start: window.start,
          end: window.end,
          sourceType: input.sourceType,
          model: process.env.GEMINI_VIDEO_MODEL || "gemini-3.7-flash",
          helperKey,
        };
        judgments[Math.floor(window.start / WINDOW)] = highlightJudgment.parse(
          input.cache
            ? await input.cache.json(descriptor, produce)
            : await produce(),
        );
        progress(15 + Math.round((80 * ++complete) / windows.length));
      });
    } catch (error) {
      signal.throwIfAborted();
      return fallback(
        error instanceof Error
          ? error.message
          : "Gemini video analysis unavailable.",
      );
    }
    const votes = new Map<SourceType, number>();
    for (const judged of judgments)
      votes.set(judged.sourceType, (votes.get(judged.sourceType) ?? 0) + 1);
    const detected =
      input.sourceType ?? [...votes].sort((a, b) => b[1] - a[1])[0][0];
    return highlightTracks.parse({
      version: 3,
      judge: "gemini",
      duration: input.duration,
      sourceType: detected,
      typeReason:
        judgments.find((j) => j.sourceType === detected)?.typeReason ??
        "User-provided source type.",
      levelStep: 0.5,
      ...audio,
      moments: judgments.flatMap((j, i) =>
        j.moments
          .filter((m) => m.start < WINDOW)
          .map((m) => ({
            ...m,
            start: m.start + windows[i].start,
            end: m.end + windows[i].start,
            reactionEnd: m.reactionEnd + windows[i].start,
            hook: {
              ...m.hook,
              start: m.hook.start + windows[i].start,
              end: m.hook.end + windows[i].start,
            },
            payoff: {
              ...m.payoff,
              start: m.payoff.start + windows[i].start,
              end: m.payoff.end + windows[i].start,
            },
          })),
      ),
      sceneCuts: [
        ...new Set(
          judgments.flatMap((j, i) =>
            j.sceneCuts.map((t) => t + windows[i].start),
          ),
        ),
      ].sort((a, b) => a - b),
      warnings: input.transcript?.words.length
        ? []
        : [
            "No timed transcript: clean boundaries need review against Gemini and measured audio pauses.",
          ],
      coverage: {
        audioSeconds: audio.audioSeconds,
        transcriptWords: input.transcript?.words.length ?? 0,
        videoWindows: windows,
      },
      elapsedMs: Date.now() - started,
    });
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof AnalysisError) {
      const reason =
        error.status === 402
          ? "Gemini native video requires a Google key with active billing (HTTP 402). Restore provider credits before retrying."
          : error.message;
      throw new AnalysisError(
        "Gemini highlight discovery could not complete: " +
          reason +
          " No partial or signal-only ranking was returned.",
        error.status,
        error.retryable,
      );
    }
    throw new AnalysisError(
      "Gemini highlight discovery could not complete. No partial or signal-only ranking was returned. Retry after video analysis is available.",
      502,
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
