import type { Timeline } from "./types";
import {
  audioNormalizationKey,
  timelineNormalizationKey,
} from "./audio-normalization";

export function remapTimelineAssets(
  item: Timeline,
  copied: (id: string) => string,
): Timeline {
  const next = {
    ...item,
    ...(item.audioNormalization
      ? {
          audioNormalization: {
            ...item.audioNormalization,
            assetId: copied(item.audioNormalization.assetId),
          },
        }
      : {}),
    clips: item.clips.map((clip) => ({
      ...clip,
      ...(clip.assetId ? { assetId: copied(clip.assetId) } : {}),
      ...(clip.normalizedAudio
        ? {
            normalizedAudio: {
              ...clip.normalizedAudio,
              assetId: copied(clip.normalizedAudio.assetId),
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
                      assetId: copied(entry.assetId),
                    })),
                  }
                : {}),
              ...(clip.scene.film?.referenceAssetId
                ? {
                    film: {
                      ...clip.scene.film,
                      referenceAssetId: copied(
                        clip.scene.film.referenceAssetId,
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
