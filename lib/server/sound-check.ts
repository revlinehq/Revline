import { resolvedAudioTimeline } from "../editor/audio-normalization";
import { spawn } from "node:child_process";
import { basename, extname, join } from "node:path";
import type { MediaWorkItem } from "../../convex/mediaTasks";
import {
  audioFadeAttributes,
  audioSettings,
  audioVolumeEnvelope,
} from "../editor/audio-settings";
import { MAX_CLIP_VOLUME } from "../editor/clip-volume";
import {
  playbackRateOf,
  sourceEndOf,
  sourceTimeAt,
  timelineTimeAtSource,
} from "../editor/playback-rate";
import type { Clip } from "../editor/types";
import { AnalysisError } from "../media-analysis/errors";
import {
  analyzeSound,
  SOUND_RATE,
  type DecodedTrack,
  type SoundKind,
  type SoundResult,
  type SoundWord,
  type VisualHit,
} from "../media-analysis/sound";

type Snapshot = NonNullable<MediaWorkItem["snapshot"]>;
const num = (value: number) => String(Math.round(value * 1e6) / 1e6);
// Short audio clips without speech are sound effects; long ones are music.
const EFFECT_LENGTH = 6;

/** Decode a source window to 48 kHz stereo float, sped up as export does; null when the source has no audio. */
function decode(
  path: string,
  seek: number,
  duration: number,
  rate: number,
  signal: AbortSignal,
  ramp?: { clip: Clip; from: number },
) {
  const tempo = (rate: number) => {
    const stages: number[] = [];
    let remaining = rate;
    while (remaining < 0.5 - 1e-9) {
      stages.push(0.5);
      remaining /= 0.5;
    }
    while (remaining > 2 + 1e-9) {
      stages.push(2);
      remaining /= 2;
    }
    if (Math.abs(remaining - 1) >= 1e-9) stages.push(remaining);
    return stages.map((stage) => `atempo=${num(stage)}`);
  };
  const filter = [...tempo(rate), `aresample=${SOUND_RATE}`].join(",");
  // Match the producer's 250 ms tempo slices, integrating the actual linear rate
  // lane at both boundaries. The caller decodes bounded timeline chunks.
  const slices = Math.max(1, Math.ceil(duration / 0.25)),
    step = duration / slices;
  const graph: string[] = [];
  let sourceDuration = duration * rate;
  if (ramp) {
    const origin = sourceTimeAt(ramp.clip, ramp.from);
    sourceDuration = sourceTimeAt(ramp.clip, ramp.from + duration) - origin;
    graph.push(
      `[0:a:0]asplit=${slices}${Array.from({ length: slices }, (_, i) => `[s${i}]`).join("")}`,
    );
    for (let i = 0; i < slices; i++) {
      const start = sourceTimeAt(ramp.clip, ramp.from + i * step) - origin;
      const end = sourceTimeAt(ramp.clip, ramp.from + (i + 1) * step) - origin;
      graph.push(
        `[s${i}]atrim=start=${num(start)}:end=${num(end)},asetpts=PTS-STARTPTS,${[...tempo((end - start) / step), `aresample=${SOUND_RATE}`, "apad", "asetpts=N/SR/TB", `atrim=end_sample=${Math.round((i + 1) * step * SOUND_RATE) - Math.round(i * step * SOUND_RATE)}`].join(",")}[t${i}]`,
      );
    }
    graph.push(
      `${Array.from({ length: slices }, (_, i) => `[t${i}]`).join("")}concat=n=${slices}:v=0:a=1[out]`,
    );
  }
  return new Promise<{ left: Float32Array; right: Float32Array } | null>(
    (resolve, reject) => {
      const child = spawn(
        "ffmpeg",
        [
          "-hide_banner",
          "-v",
          "error",
          "-nostdin",
          "-ss",
          num(seek),
          "-t",
          num(sourceDuration),
          "-i",
          path,
          ...(ramp
            ? ["-filter_complex", graph.join(";"), "-map", "[out]"]
            : ["-map", "0:a:0?", "-af", filter]),
          "-vn",
          "-sn",
          "-dn",
          "-ac",
          "2",
          "-f",
          "f32le",
          "pipe:1",
        ],
        { stdio: ["ignore", "pipe", "pipe"], signal },
      );
      const chunks: Buffer[] = [];
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-1000);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        const bytes = Buffer.concat(chunks);
        if (!bytes.length)
          return /does not contain any stream|matches no streams|Output file is empty/i.test(
            stderr,
          ) || code === 0
            ? resolve(null)
            : reject(
                new AnalysisError(
                  `Audio could not be decoded: ${stderr.trim().slice(-300)}`,
                  500,
                ),
              );
        if (code !== 0)
          return reject(
            new AnalysisError(
              `Audio could not be decoded: ${stderr.trim().slice(-300)}`,
              500,
            ),
          );
        const samples = new Float32Array(
          bytes.buffer,
          bytes.byteOffset,
          Math.floor(bytes.length / 8) * 2,
        );
        const frames = samples.length / 2,
          left = new Float32Array(frames),
          right = new Float32Array(frames);
        for (let i = 0; i < frames; i++) {
          left[i] = samples[2 * i];
          right[i] = samples[2 * i + 1];
        }
        resolve({ left, right });
      });
    },
  );
}

/** The clip's gain at a time since its start: its volume lane (ducking, phase fades) times its own fades. */
function gainOf(timeline: Snapshot["timeline"], clip: Clip, volume: number) {
  const points = (
    JSON.parse(audioVolumeEnvelope(timeline, clip, volume)) as {
      lanes: { points: { t: number; v: number }[] }[];
    }
  ).lanes[0].points;
  const { fadeIn, fadeOut } = audioFadeAttributes(clip);
  return (elapsed: number) => {
    let index = 0;
    while (index + 1 < points.length && points[index + 1].t <= elapsed) index++;
    const a = points[index],
      b = points[index + 1],
      lane = b
        ? a.v + ((b.v - a.v) * (elapsed - a.t)) / Math.max(1e-9, b.t - a.t)
        : a.v;
    return (
      lane *
      (fadeIn > 0 ? Math.min(1, elapsed / fadeIn) : 1) *
      (fadeOut > 0
        ? Math.min(1, Math.max(0, (clip.duration - elapsed) / fadeOut))
        : 1)
    );
  };
}

/** Decode every clip that sounds in the range as export mixes it, find the words spoken there, and analyze it. */
export async function decodeTimelineSound(
  snapshot: Snapshot,
  directory: string,
  assetUrls: Record<string, string>,
  audioSourceOffsets: Record<string, number>,
  range: { start: number; end: number },
  signal: AbortSignal,
  consume?: (track: DecodedTrack) => void,
  selectedClipId?: string,
) {
  const timeline = resolvedAudioTimeline(snapshot.timeline),
    assets = new Map(
      snapshot.assets.map((asset) => [asset._id as string, asset]),
    );
  const tracks: DecodedTrack[] = [],
    words: SoundWord[] = [];
  // Word evidence stays on authored sources even when the sounding file is a normalized mix.
  for (const clip of snapshot.timeline.clips) {
    if (selectedClipId && clip.id !== selectedClipId) continue;
    if (
      !clip.assetId ||
      !["audio", "video"].includes(clip.kind) ||
      (clip.volume ?? 1) <= 0
    )
      continue;
    const source = assets.get(clip.assetId),
      end = sourceEndOf(clip);
    words.push(
      ...(source?.analysis?.transcript?.words ?? [])
        .filter(
          (w) => w.start >= clip.sourceStart - 1e-7 && w.start < end - 1e-7,
        )
        .map((w) => ({
          text: w.text,
          start: timelineTimeAtSource(clip, w.start),
          end: timelineTimeAtSource(clip, Math.min(w.end, end)),
        }))
        .filter((w) => w.end > range.start && w.start < range.end),
    );
  }
  for (const clip of timeline.clips) {
    if (selectedClipId && clip.id !== selectedClipId) continue;
    if ((clip.kind !== "audio" && clip.kind !== "video") || !clip.assetId)
      continue;
    const volume = Number.isFinite(clip.volume)
      ? Math.min(MAX_CLIP_VOLUME, Math.max(0, clip.volume!))
      : 1;
    const from = Math.max(range.start, clip.start),
      to = Math.min(range.end, clip.start + clip.duration),
      asset = assets.get(clip.assetId),
      url = assetUrls[clip.assetId];
    if (volume === 0 || to <= from || !asset || !url?.startsWith("./"))
      continue;
    const rate = playbackRateOf(clip);
    const role = audioSettings(clip).role;
    const kind: SoundKind =
      clip.kind === "video"
        ? "footage"
        : role === "voice" || asset.analysis?.transcript?.words.length
          ? "voice"
          : role === "music" || clip.duration > EFFECT_LENGTH
            ? "music"
            : "sfx";
    const name = basename(asset.fileName, extname(asset.fileName)).slice(0, 60);
    const offset = audioSourceOffsets[clip.assetId] ?? 0;
    for (let chunkStart = from; chunkStart < to - 1e-8; chunkStart += 10) {
      const chunkEnd = Math.min(to, chunkStart + 10);
      const decoded = await decode(
        join(directory, url.slice(2)),
        Math.max(0, sourceTimeAt(clip, chunkStart) - offset),
        chunkEnd - chunkStart,
        rate,
        signal,
        clip.speedRamp?.length ? { clip, from: chunkStart } : undefined,
      );
      if (!decoded) continue;
      const gain = gainOf(timeline, clip, volume),
        first = Math.round((chunkStart - range.start) * SOUND_RATE),
        length = Math.min(
          decoded.left.length,
          Math.round((chunkEnd - chunkStart) * SOUND_RATE),
        );
      const left = decoded.left.subarray(0, length),
        right = decoded.right.subarray(0, length);
      for (let i = 0; i < length; i++) {
        const g = gain(chunkStart - clip.start + i / SOUND_RATE);
        left[i] *= g;
        right[i] *= g;
      }
      const track: DecodedTrack = {
        event: {
          clipId: clip.id,
          name,
          kind,
          start: Math.round(clip.start * 1000) / 1000,
          end: Math.round((clip.start + clip.duration) * 1000) / 1000,
          gain: Math.round(volume * 100) / 100,
        },
        offset: first,
        left,
        right,
      };
      if (consume) consume(track);
      else tracks.push(track);
    }
  }
  return { tracks, words };
}

/** Analyze exactly the decoded gain/fade/speed/ducking mix used for normalization. */
export async function measureTimelineSound(
  snapshot: Snapshot,
  directory: string,
  assetUrls: Record<string, string>,
  audioSourceOffsets: Record<string, number>,
  range: { start: number; end: number },
  signal: AbortSignal,
  check?: { fps: number; hits: VisualHit[] },
): Promise<SoundResult> {
  const { tracks, words } = await decodeTimelineSound(
    snapshot,
    directory,
    assetUrls,
    audioSourceOffsets,
    range,
    signal,
  );
  if (!tracks.length && !check)
    throw new AnalysisError(
      "Nothing sounds in this range: no audio or footage with sound plays here.",
      400,
    );
  const masterGain = Number(process.env.PRODUCER_AUDIO_GAIN ?? 1);
  return analyzeSound(
    tracks,
    words.sort((a, b) => a.start - b.start),
    range,
    Number.isFinite(masterGain) && masterGain >= 0 ? masterGain : 1,
    check && { ...check, timelineFps: snapshot.timeline.fps },
  );
}
