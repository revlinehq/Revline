import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { ExportResolution } from '../editor/composition';
import type { PlainExportPlan } from '../editor/plain-export';
import type { Clip, Timeline } from '../editor/types';
import { linkCompositionResources, writeComposition } from './prepare-composition';
import { runCompositionCapture } from './render-worker';
import { reuseCachedMediaFile, reuseMediaFile } from './media-file-cache';

/**
 * Rasterize each static text clip of a fast export once, with the export's own browser text
 * renderer and screenshot engine. Every text is captured alone over black and over white;
 * the two captures give its exact coverage (alpha = 1 - (white - black)) and colour
 * (black / alpha), so FFmpeg's straight-alpha overlay reproduces the browser composite.
 * Rasters are cached on the worker by the text's look (scope: one backend project), so a
 * re-export with unchanged text opens no browser. Returns one transparent PNG path per
 * plan.text entry, in the same order.
 */
export async function rasterizeTextOverlays(directory: string, timeline: Timeline, plan: PlainExportPlan, resolution: ExportResolution, signal: AbortSignal, scope?: string): Promise<string[]> {
  const { fps, width, height } = plan;
  const outputs = plan.text.map((_, index) => join(directory, `text-overlay-${index}.png`));
  const variant = (index: number) => `text-raster-v1:${createHash('sha256').update(plan.text[index].look).digest('hex')}`;
  const missing: number[] = [];
  for (const index of plan.text.keys()) if (!await reuseCachedMediaFile({ identity: scope, variant: variant(index), target: outputs[index], signal, pool: 'export-segments' })) missing.push(index);
  if (!missing.length) return outputs;
  // Each text gets its own short slot in one bounded capture window (at most three seconds).
  const slot = Math.max(2, Math.floor(3 * fps / missing.length));
  const clips = missing.map(text => plan.text[text]).map(({ clipId }, index): Clip => {
    const clip = timeline.clips.find(item => item.id === clipId);
    if (!clip) throw new Error('A fast export text clip is missing.');
    return { ...clip, track: 2, start: index * slot / fps, duration: slot / fps };
  });
  const white: Clip = { id: 'fast-export-text-matte', kind: 'solid', track: 1, start: 0, duration: missing.length * slot / fps, sourceStart: 0, solidColor: { color: '#ffffff', width: 1, height: 1, x: .5, y: .5, opacity: 1 } };
  const root = join(directory, 'text-raster');
  for (const [variant, layers] of [['edited', clips], ['reference', [white, ...clips]]] as [string, Clip[]][]) {
    const path = join(root, variant);
    await mkdir(path, { recursive: true });
    await linkCompositionResources(directory, path, {});
    await writeComposition(path, { ...timeline, clips: layers, tracks: undefined, markers: undefined }, [], {}, resolution, fps, './', signal);
  }
  const times = clips.map((_, index) => (index * slot + 1) / fps);
  await runCompositionCapture(root, { width, height, fps, times, start: 0, end: missing.length * slot / fps, variants: ['edited', 'reference'] }, signal);
  await Promise.all(clips.map(async (_, index) => {
    const read = async (variant: string) => {
      const { data, info } = await sharp(await readFile(join(root, variant, `sample-${index}.png`))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      if (info.width !== width || info.height !== height || info.channels !== 3) throw new Error('A fast export text capture has the wrong size.');
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
    await reuseMediaFile({ identity: scope, variant: variant(missing[index]), target: output, signal, pool: 'export-segments' }, async () => {});
  }));
  return outputs;
}
