import { DEFAULT_AUDIO_SETTINGS } from "./audio-settings";
import { timelineDuration, type Clip, type Timeline } from "./types";

// Convex may reorder nested object fields while retaining exactly the same sound settings.
const stableJson = (value: object) =>
  JSON.stringify(value, (_key: string, entry: unknown) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : entry,
  );

/** Keep the authored source, speech evidence and reciprocal video link intact. */
export function audioNormalizationKey(timeline: Timeline, clip: Clip) {
  const source = {
    assetId: clip.assetId,
    start: clip.start,
    duration: clip.duration,
    sourceStart: clip.sourceStart,
    playbackRate: clip.playbackRate,
    speedRamp: clip.speedRamp,
    volume: clip.volume,
    audio: clip.audio,
    audioFadeTiming: clip.audioFadeTiming,
  };
  const voices =
    clip.audio?.role === "music" && clip.audio.ducking.enabled
      ? timeline.clips
          .filter(
            (c) =>
              c.kind === "audio" &&
              c.audio?.role === "voice" &&
              (c.volume ?? 1) > 0,
          )
          .map((c) => ({ id: c.id, start: c.start, duration: c.duration }))
      : [];
  return stableJson({ source, voices });
}

/** A compact change detector, not an authentication token. Track ordering is retained in the mix signature. */
export function timelineNormalizationKey(timeline: Timeline) {
  const source = stableJson({
    duration: timelineDuration(timeline),
    clips: timeline.clips
      .filter((c) => c.kind === "audio" || c.kind === "video")
      .map((c) => ({
        id: c.id,
        kind: c.kind,
        assetId: c.assetId,
        start: c.start,
        duration: c.duration,
        sourceStart: c.sourceStart,
        playbackRate: c.playbackRate,
        speedRamp: c.speedRamp,
        volume: c.volume,
        audio: c.audio,
        audioFadeTiming: c.audioFadeTiming,
        normalizedAudio: c.normalizedAudio,
      })),
  });
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < source.length; i++) {
    a = Math.imul(a ^ source.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ source.charCodeAt(i);
  }
  return `${a >>> 0}:${b >>> 0}`;
}

/** One playback projection for preview, export, listening and re-normalization. Edits invalidate the bake. */
export function resolvedAudioTimeline(timeline: Timeline): Timeline {
  const master = timeline.audioNormalization;
  if (master && master.key === timelineNormalizationKey(timeline)) {
    let id = "normalized-master";
    while (timeline.clips.some((c) => c.id === id)) id += "-";
    return {
      ...timeline,
      audioNormalization: undefined,
      clips: [
        ...timeline.clips.map((c) =>
          c.kind === "audio" || c.kind === "video"
            ? { ...c, volume: 0, normalizedAudio: undefined }
            : c,
        ),
        {
          id,
          kind: "audio",
          track: 1,
          assetId: master.assetId,
          start: 0,
          duration: timelineDuration(timeline),
          sourceStart: master.offset ?? 0,
          volume: 1,
        },
      ],
    };
  }
  return {
    ...timeline,
    audioNormalization: undefined,
    clips: timeline.clips.map((clip) => {
      const bake = clip.normalizedAudio;
      if (
        clip.kind !== "audio" ||
        !bake ||
        bake.key !== audioNormalizationKey(timeline, clip)
      )
        return clip;
      const { normalizedAudio: _, ...source } = clip;
      return {
        ...source,
        assetId: bake.assetId,
        sourceStart: bake.offset ?? 0,
        playbackRate: 1,
        speedRamp: undefined,
        volume: 1,
        audio: {
          ...DEFAULT_AUDIO_SETTINGS,
          role: clip.audio?.role ?? "original",
        },
        audioFadeTiming: undefined,
      };
    }),
  };
}

/** Alternate sound files are retained by edits, shares and exports just like original media. */
export function normalizationAssetIds(timeline: Timeline): string[] {
  return [
    ...(timeline.audioNormalization
      ? [timeline.audioNormalization.assetId]
      : []),
    ...timeline.clips.flatMap((clip) =>
      clip.normalizedAudio ? [clip.normalizedAudio.assetId] : [],
    ),
  ];
}
