import type { MediaAsset, Timeline } from './types';

/** Only changes to rendered content require a new decoded player. */
export function previewContentKey(timeline: Timeline, assets: MediaAsset[]): string {
  const used = new Set(timeline.clips.flatMap(clip => clip.assetId ? [clip.assetId] : []));
  const effects = timeline.clips.some(clip => clip.kind === 'effect');
  return JSON.stringify({
    timeline: { ...timeline, tracks: undefined, markers: undefined, clips: timeline.clips.map(({ track, volume, colorGrade: _colorGrade, zoomBlur: _zoomBlur, glitch: _glitch, invert: _invert, ...clip }) => {
      const rendered = clip.kind === 'caption' || clip.kind === 'graphic' ? { ...clip, text: undefined, color: undefined, fontSize: undefined, background: undefined, x: undefined, y: undefined, blendMode: undefined, animation: undefined, motion: undefined, motionOffset: undefined, textTemplate: undefined } : clip;
      return effects ? { ...rendered, track } : rendered;
    }) },
    assets: assets.filter(asset => used.has(asset._id)).map(({ _id, kind, width, height, url }) => ({ _id, kind, width, height, url: url?.split('?token=')[0] ?? null })),
  });
}
