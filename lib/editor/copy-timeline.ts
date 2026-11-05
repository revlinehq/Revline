import type { Timeline } from "./types";
import {
  audioNormalizationKey,
  timelineNormalizationKey,
} from "./audio-normalization";

/** Which kind of reference an asset id comes from, so a caller can map them differently. */
export type TimelineAssetReference =
  | "audioNormalization"
  | "clip"
  | "normalizedAudio"
  | "sceneMedia"
  | "filmReference";

export function remapTimelineAssets(
  item: Timeline,
  copied: (id: string, reference: TimelineAssetReference) => string,
): Timeline {
  const next = {
    ...item,
    ...(item.audioNormalization
      ? {
          audioNormalization: {
            ...item.audioNormalization,
            assetId: copied(
              item.audioNormalization.assetId,
              "audioNormalization",
            ),
          },
        }
      : {}),
    clips: item.clips.map((clip) => ({
      ...clip,
      ...(clip.assetId ? { assetId: copied(clip.assetId, "clip") } : {}),
      ...(clip.normalizedAudio
        ? {
            normalizedAudio: {
              ...clip.normalizedAudio,
              assetId: copied(
                clip.normalizedAudio.assetId,
                "normalizedAudio",
              ),
            },
          }
        : {}),
      ...(clip.scene
        ? {
            scene: {
              ...clip.scene,
              ...(clip.scene.media
                ? {
                    media: clip.scene.media.map((entry) => ({
                      ...entry,
                      assetId: copied(entry.assetId, "sceneMedia"),
                    })),
                  }
                : {}),
              ...(clip.scene.film?.referenceAssetId
                ? {
                    film: {
                      ...clip.scene.film,
                      referenceAssetId: copied(
                        clip.scene.film.referenceAssetId,
                        "filmReference",
                      ),
                    },
                  }
                : {}),
            },
          }
        : {}),
    })),
  };
  const baked = {
    ...next,
    clips: next.clips.map((clip, i) =>
      clip.normalizedAudio &&
      item.clips[i].normalizedAudio?.key ===
        audioNormalizationKey(item, item.clips[i])
        ? {
            ...clip,
            normalizedAudio: {
              ...clip.normalizedAudio,
              key: audioNormalizationKey(next, clip),
            },
          }
        : clip,
    ),
  };
  const master = item.audioNormalization;
  if (
    master?.key === timelineNormalizationKey(item) &&
    baked.audioNormalization
  )
    baked.audioNormalization.key = timelineNormalizationKey(baked);
  return baked;
}
