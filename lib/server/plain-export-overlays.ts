import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { ExportResolution } from '../editor/composition';
import type { PlainExportPlan } from '../editor/plain-export';
import type { Clip, MediaAsset, Timeline } from '../editor/types';
import { linkCompositionResources, writeComposition } from './prepare-composition';
import { runCompositionCapture } from './render-worker';
import { reuseCachedMediaFile, reuseMediaFile } from './media-file-cache';
import { forEachLimited } from './run-limited';

const OVERLAY_BATCH = 180;
/** Full-frame rasters whose alpha is recovered at once: each holds about 20 MB at 1080x1920. */
const ALPHA_CONCURRENCY = 4;

/**
 * Rasterize each static text and still image clip of a fast export once, with the export's own
 * browser renderer and screenshot engine. Every overlay is captured alone over black and over
 * white; the two captures give its exact coverage (alpha = 1 - (white - black)) and colour
 * (black / alpha), so FFmpeg's straight-alpha overlay reproduces the browser composite.
 * Rasters are cached on the worker by the clip's look and, for an image, its file identity
 * (scope: one backend project), so a re-export with unchanged overlays opens no browser.
 * An image overlay with no file identity is never cached. Returns one transparent PNG path
 * per plan.overlays entry, in the same order.
 */
export async function rasterizeOverlays(directory: string, timeline: Timeline, plan: PlainExportPlan, resolution: ExportResolution, signal: AbortSignal, media: { assets: MediaAsset[]; assetUrls: Record<string, string>; identities: Record<string, string> }, scope?: string): Promise<string[]> {
  const { fps, width, height } = plan;
  const outputs = plan.overlays.map((_, index) => join(directory, `overlay-${index}.png`));
  const identity = (index: number) => { const { assetId } = plan.overlays[index]; return assetId ? media.identities[assetId] : ''; };
  const cacheScope = (index: number) => identity(index) === undefined ? undefined : scope;
  const variant = (index: number) => `overlay-raster-v1:${createHash('sha256').update(JSON.stringify([plan.overlays[index].look, identity(index)])).digest('hex')}`;
  const cached = await Promise.all([...plan.overlays.keys()].map(index => reuseCachedMediaFile({ identity: cacheScope(index), variant: variant(index), target: outputs[index], signal, pool: 'export-segments' })));
  const missing = [...plan.overlays.keys()].filter(index => !cached[index]);
  if (!missing.length) return outputs;
  // Only the images being captured are linked into the capture compositions.
  const imageIds = new Set(missing.flatMap(index => plan.overlays[index].assetId ?? []));
  const assets = media.assets.filter(asset => imageIds.has(asset._id));
  const assetUrls = Object.fromEntries(Object.entries(media.assetUrls).filter(([assetId]) => imageIds.has(assetId)));
  if (assets.length !== imageIds.size || Object.keys(assetUrls).length !== imageIds.size) throw new Error('A fast export image overlay is unavailable.');
  // The capture worker takes at most 180 sparse samples in a 60 s window. Overlay compositions hold no
  // video, so sparse capture only lifts the dense bounds (12 in 3 s); batches of 180 stay within them.
  for (let from = 0; from < missing.length; from += OVERLAY_BATCH) await captureBatch(directory, timeline, plan, resolution, signal, assets, assetUrls, missing.slice(from, from + OVERLAY_BATCH), outputs, cacheScope, variant, from / OVERLAY_BATCH);
  return outputs;
}

/** Capture one batch of overlays in its own bounded window over black and white, and write their transparent rasters. */
async function captureBatch(directory: string, timeline: Timeline, plan: PlainExportPlan, resolution: ExportResolution, signal: AbortSignal, assets: MediaAsset[], assetUrls: Record<string, string>, missing: number[], outputs: string[], cacheScope: (index: number) => string | undefined, variant: (index: number) => string, batch: number) {
  const { fps, width, height } = plan;
  // Each overlay gets its own short slot: at most three seconds for 12, at least two frames each.
  const slot = Math.max(2, Math.floor(3 * fps / missing.length));
  const clips = missing.map(overlay => plan.overlays[overlay]).map(({ clipId }, index): Clip => {
    const clip = timeline.clips.find(item => item.id === clipId);
    if (!clip) throw new Error('A fast export overlay clip is missing.');
    // Captured fully opaque: fades and the basic text entrance are applied per frame by FFmpeg.
    return { ...clip, track: 2, start: index * slot / fps, duration: slot / fps, animation: undefined, textAnimationTiming: undefined, visualFade: undefined, visualFadeTiming: undefined };
  });
  const white: Clip = { id: 'fast-export-text-matte', kind: 'solid', track: 1, start: 0, duration: missing.length * slot / fps, sourceStart: 0, solidColor: { color: '#ffffff', width: 1, height: 1, x: .5, y: .5, opacity: 1 } };
  const root = join(directory, `text-raster-${batch}`);
  for (const [name, layers] of [['edited', clips], ['reference', [white, ...clips]]] as [string, Clip[]][]) {
    const path = join(root, name);
    await mkdir(path, { recursive: true });
    await linkCompositionResources(directory, path, assetUrls);
    await writeComposition(path, { ...timeline, clips: layers, tracks: undefined, markers: undefined }, assets, assetUrls, resolution, fps, './', signal);
  }
  const times = clips.map((_, index) => (index * slot + 1) / fps);
  await runCompositionCapture(root, { width, height, fps, times, start: 0, end: missing.length * slot / fps, variants: ['edited', 'reference'], sparse: true }, signal);
  await forEachLimited([...clips.keys()], ALPHA_CONCURRENCY, async index => {
    const read = async (name: string) => {
      const { data, info } = await sharp(await readFile(join(root, name, `sample-${index}.png`))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      if (info.width !== width || info.height !== height || info.channels !== 3) throw new Error('A fast export overlay capture has the wrong size.');
      return data;
    };
    const [black, whiteBackground] = await Promise.all([read('edited'), read('reference')]);
    const rgba = Buffer.alloc(width * height * 4);
    for (let pixel = 0, source = 0, target = 0; pixel < width * height; pixel++, source += 3, target += 4) {
      const difference = (whiteBackground[source] - black[source] + whiteBackground[source + 1] - black[source + 1] + whiteBackground[source + 2] - black[source + 2]) / 3;
      const alpha = Math.min(255, Math.max(0, Math.round(255 - difference)));
      if (!alpha) continue;
      for (let channel = 0; channel < 3; channel++) rgba[target + channel] = Math.min(255, Math.round(black[source + channel] * 255 / alpha));
      rgba[target + 3] = alpha;
    }
    const output = outputs[missing[index]];
    await writeFile(output, await sharp(rgba, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 1 }).toBuffer());
    // The raster already exists; this only retains it for the next export.
    await reuseMediaFile({ identity: cacheScope(missing[index]), variant: variant(missing[index]), target: output, signal, pool: 'export-segments' }, async () => {});
  });
  // Two full-frame screenshots per overlay; only the rasters are kept.
  await rm(root, { recursive: true, force: true });
}
