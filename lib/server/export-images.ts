import { execFile } from 'node:child_process';
import { mkdir, open, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Clip, MediaAsset, Timeline } from '../editor/types';

const run = promisify(execFile);

type ExportAsset = MediaAsset & { contentType?: string };
export type ExportImages<A extends ExportAsset> = {
  timeline: Timeline; assets: A[]; assetUrls: Record<string, string>;
  /** Set when a converted image still needs the browser renderer (a transparent animation). */
  browserReason?: string;
  /** One short line per converted file, for the export log. */
  notes: string[];
};

/** RIFF/WebP header: animated when the extended (VP8X) header sets the animation flag. */
async function webpKind(path: string): Promise<'still' | 'animated' | undefined> {
  const file = await open(path, 'r');
  try {
    const { buffer, bytesRead } = await file.read(Buffer.alloc(21), 0, 21, 0);
    if (bytesRead < 16 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return undefined;
    return buffer.toString('ascii', 12, 16) === 'VP8X' && bytesRead >= 21 && (buffer[20] & 0x02) ? 'animated' : 'still';
  } finally { await file.close(); }
}

/** Frame durations (ms) and loop count from `webpmux -info`. Browsers play frames of 10 ms or less for 100 ms. */
async function animationTiming(path: string, signal: AbortSignal) {
  const { stdout } = await run('webpmux', ['-info', path], { signal, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  const loops = Number(/Loop Count\s*:\s*(\d+)/.exec(stdout)?.[1] ?? 0);
  const durations = stdout.split('\n').flatMap(line => {
    const cells = /^\s*\d+:\s+(.*)$/.exec(line)?.[1].trim().split(/\s+/);
    return cells && cells.length >= 6 ? [Number(cells[5])] : [];
  }).map(ms => Number.isFinite(ms) && ms > 10 ? ms : 100);
  if (!durations.length) throw new Error('webpmux listed no animation frames.');
  return { durations, loops };
}

/** Whether any decoded frame (an ffconcat list of them) has a pixel that is not fully opaque. */
async function hasTransparency(list: string, signal: AbortSignal) {
  const { stderr } = await run('ffmpeg', ['-v', 'info', '-hide_banner', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'format=rgba,alphaextract,signalstats,metadata=print:key=lavfi.signalstats.YMIN', '-f', 'null', '-'], { signal, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
  return [...stderr.matchAll(/lavfi\.signalstats\.YMIN=(\d+)/g)].some(match => Number(match[1]) < 255);
}

/**
 * WebP images in an export, made drawable without the browser where possible. A still WebP becomes a PNG,
 * which the FFmpeg path lays over the footage like any PNG. An animated WebP becomes a video of the export's
 * frame rate, playing its frames on their own timing from the clip's start (as the browser plays an <img>),
 * and its clips become muted video clips: opaque H.264 the FFmpeg path stacks, or VP9 with alpha, which
 * the browser renderer seeks frame by frame instead of letting the image animate on the wall clock.
 * Decoding needs libwebp's anim_dump and webpmux; without them the original image is kept.
 */
export async function prepareExportImages<A extends ExportAsset>(directory: string, timeline: Timeline, assets: A[], assetUrls: Record<string, string>, fps: number, signal: AbortSignal): Promise<ExportImages<A>> {
  const notes: string[] = [];
  let browserReason: string | undefined;
  const urls = { ...assetUrls }, replaced = new Map<string, A>(), animated = new Set<string>();
  for (const asset of assets) {
    const url = urls[asset._id];
    if (asset.kind !== 'image' || !url?.startsWith('./')) continue;
    if ((asset.contentType ?? '').toLowerCase() !== 'image/webp' && !/\.webp$/i.test(asset.fileName)) continue;
    const clips = timeline.clips.filter(clip => clip.kind === 'image' && clip.assetId === asset._id);
    if (!clips.length) continue;
    const source = join(directory, url.slice(2)), kind = await webpKind(source).catch(() => undefined);
    const base = url.slice(2).replace(/\.[^.]+$/, '');
    if (kind === 'still') {
      try {
        await run('ffmpeg', ['-v', 'error', '-i', source, '-frames:v', '1', '-y', join(directory, `${base}-still.png`)], { signal, timeout: 60_000 });
        urls[asset._id] = `./${base}-still.png`;
        replaced.set(asset._id, { ...asset, contentType: 'image/png' });
        notes.push(`${asset.fileName}: still WebP drawn as PNG`);
      } catch (error) {
        if (signal.aborted) throw error;
        notes.push(`${asset.fileName}: still WebP kept as an image (${(error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 200)})`);
      }
      continue;
    }
    if (kind !== 'animated') continue;
    const startedAt = Date.now();
    try {
      const { durations, loops } = await animationTiming(source, signal);
      const frames = join(directory, `${base}-frames`);
      await mkdir(frames, { recursive: true });
      await run('anim_dump', ['-folder', frames, '-prefix', 'f_', source], { signal, timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
      const names = (await readdir(frames)).filter(name => /^f_\d+\.png$/.test(name)).sort((a, b) => Number(a.slice(2, -4)) - Number(b.slice(2, -4)));
      if (names.length !== durations.length) throw new Error(`anim_dump wrote ${names.length} frames for ${durations.length} listed.`);
      // Long enough for every clip's span; a finite loop count plays that many times and holds the last frame.
      const needed = Math.max(...clips.map(clip => clip.duration)) + 1, cycle = durations.reduce((sum, ms) => sum + ms, 0) / 1000;
      const plays = Math.max(1, Math.min(loops > 0 ? loops : Infinity, Math.ceil(needed / cycle)));
      const list = [...Array(plays)].flatMap(() => names.map((name, index) => `file '${join(frames, name)}'\nduration ${(durations[index] / 1000).toFixed(4)}`));
      list.push(`file '${join(frames, names.at(-1)!)}'`);
      await writeFile(join(frames, 'list.txt'), `ffconcat version 1.0\n${list.join('\n')}\n`);
      await writeFile(join(frames, 'cycle.txt'), `ffconcat version 1.0\n${names.map(name => `file '${join(frames, name)}'`).join('\n')}\n`);
      const alpha = await hasTransparency(join(frames, 'cycle.txt'), signal);
      const output = `${base}-animation.${alpha ? 'webm' : 'mp4'}`;
      const hold = Math.max(0, needed - plays * cycle);
      await run('ffmpeg', ['-v', 'error', '-f', 'concat', '-safe', '0', '-i', join(frames, 'list.txt'),
        '-vf', `${hold > 0 ? `tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)},` : ''}fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=${alpha ? 'yuva420p' : 'yuv420p'}`,
        '-t', needed.toFixed(3), '-an',
        ...(alpha ? ['-c:v', 'libvpx-vp9', '-auto-alt-ref', '0', '-b:v', '0', '-crf', '18', '-deadline', 'realtime', '-row-mt', '1'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-movflags', '+faststart']),
        '-y', join(directory, output)], { signal, timeout: 600_000, maxBuffer: 4 * 1024 * 1024 });
      const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', join(directory, output)], { signal, timeout: 30_000 });
      const [width, height] = stdout.trim().split(',').map(Number);
      urls[asset._id] = `./${output}`;
      replaced.set(asset._id, { ...asset, kind: 'video', contentType: alpha ? 'video/webm' : 'video/mp4', duration: needed, width, height });
      animated.add(asset._id);
      if (alpha) browserReason ??= `${asset.fileName} is a transparent animated WebP, drawn by the browser as a video`;
      notes.push(`${asset.fileName}: animated WebP (${durations.length} frames, ${cycle.toFixed(2)}s loop) converted to ${alpha ? 'VP9 with alpha' : 'H.264'} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    } catch (error) {
      if (signal.aborted) throw error;
      // Missing libwebp tools or an unreadable file: the browser draws the original image, as before.
      notes.push(`${asset.fileName}: animated WebP kept as an image (${(error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 200)})`);
      browserReason ??= `${asset.fileName} is an animated WebP that could not be converted`;
    }
  }
  if (!replaced.size) return { timeline, assets, assetUrls, notes, ...browserReason ? { browserReason } : {} };
  // An animated image plays from its clip's start: the clip becomes a muted video read from source 0.
  const clips = timeline.clips.map((clip): Clip => {
    if (!clip.assetId || !animated.has(clip.assetId) || clip.kind !== 'image') return clip;
    const { playbackRate: _rate, ...rest } = clip;
    return { ...rest, kind: 'video', sourceStart: 0, volume: 0 };
  });
  return { timeline: { ...timeline, clips }, assets: assets.map(asset => replaced.get(asset._id) ?? asset), assetUrls: urls, notes, ...browserReason ? { browserReason } : {} };
}
