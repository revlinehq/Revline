import { layerGroup, trackOf, timelineDuration, type MediaAsset, type Timeline } from './types';

/** Only changes to rendered content require a new decoded player. */
export function previewContentKey(timeline: Timeline, assets: MediaAsset[]): string {
  const used = new Set(timeline.clips.flatMap(clip => clip.assetId ? [clip.assetId] : []));
  return JSON.stringify({
    duration: timelineDuration(timeline),
    timeline: { ...timeline, tracks: undefined, markers: undefined, clips: timeline.clips.map(({ track, volume, colorGrade: _colorGrade, zoomBlur: _zoomBlur, glitch: _glitch, invert: _invert, ...clip }) => {
      const rendered = clip.kind === 'caption' || clip.kind === 'graphic' ? { ...clip, text: undefined, color: undefined, fontSize: undefined, background: undefined, x: undefined, y: undefined, blendMode: undefined, animation: undefined, motion: undefined, motionOffset: undefined, textTemplate: undefined } : clip;
      const content = clip.kind === 'video' || clip.kind === 'image' ? { ...rendered, crop: undefined, fit: undefined, transform: undefined, blendMode: undefined } : clip.kind === 'effect' && clip.effectPreset === 'cinematic-bars' ? { ...rendered, cinematicBars: undefined, motion: undefined, motionOffset: undefined, start: undefined, duration: undefined } : rendered;
      return { ...content, group: layerGroup(clip.kind), ...(clip.kind === 'effect' ? { track: trackOf({ kind: clip.kind, track }) } : {}) };
    }) },
    assets: assets.filter(asset => used.has(asset._id)).map(({ _id, kind, width, height, url }) => ({ _id, kind, width, height, url: url?.split('?token=')[0] ?? null })),
  });
}
