'use client';

import { useCallback, useMemo, useState } from 'react';
import type { MediaAsset } from '@/lib/editor/types';

/** Timeline stills share the player's prepared source instead of reopening originals. */
export function usePlaybackSources(assets: MediaAsset[]) {
  const [prepared, setPrepared] = useState<MediaAsset[]>([]);
  const onPlaybackAssets = useCallback((next: MediaAsset[]) => {
    setPrepared(previous => {
      const sources = new Map(previous.map(asset => [asset._id, asset]));
      let changed = false;
      for (const asset of next) {
        const before = sources.get(asset._id);
        if (before?.url === asset.url && before?.previewVersion === asset.previewVersion && before?.previewSize === asset.previewSize) continue;
        sources.set(asset._id, asset); changed = true;
      }
      return changed ? [...sources.values()] : previous;
    });
  }, []);
  const timelineAssets = useMemo(() => {
    const sources = new Map(prepared.map(asset => [asset._id, asset]));
    return assets.map(asset => {
      if (asset.kind !== 'video' || !asset.previewUrl) return asset;
      const source = sources.get(asset._id);
      if (source?.previewUrl && source.previewVersion === asset.previewVersion && source.previewSize === asset.previewSize && source.url) return { ...asset, url: source.url };
      // Wait for the bounded shared download. Large derivatives use native
      // ranges immediately; neither path opens the original for filmstrips.
      const bounded = Number.isSafeInteger(asset.previewSize) && asset.previewSize! > 0 && asset.previewSize! <= 64 * 1024 * 1024;
      return bounded ? { ...asset, url: null, previewUrl: undefined } : { ...asset, url: asset.previewUrl };
    });
  }, [assets, prepared]);
  return { timelineAssets, onPlaybackAssets };
}
