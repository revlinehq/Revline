import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { trackBox } from '../media-analysis/pixel-track';
import { AnalysisError } from '../media-analysis/errors';
import { locateTrackingObject } from '../media-analysis/gemini';
import { optionalGeminiVision } from './optional-gemini-vision';
import { configuredFal, subscribe } from './fal';

const run = promisify(execFile);
const frameInfo = z.object({ streams: z.array(z.object({ width: z.number().positive(), height: z.number().positive() })).min(1) });
const originInfo = z.object({ format: z.object({ start_time: z.coerce.number().finite().optional() }) });
const grounding = z.object({ results: z.object({ bboxes: z.array(z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative(), w: z.number().positive(), h: z.number().positive(), label: z.string() })) }) });
const OBJECT_GROUNDING_ENDPOINT = 'fal-ai/florence-2-large/open-vocabulary-detection';

/** One native frame leaves the processor. Explicit point/box seeds never call a provider. */
export async function localizeTrackingObject(source: string, directory: string, time: number, noun: string, signal: AbortSignal) {
  const path = join(directory, 'tracking-object.jpg');
  const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=start_time', '-of', 'json', source], { signal, maxBuffer: 65536 });
  const origin = originInfo.parse(JSON.parse(probe.stdout)).format.start_time ?? 0;
  try {
    const decoded = await run('ffmpeg', ['-v', 'info', '-copyts', '-ss', String(Math.max(0, time - .5)), '-i', source, '-map', '0:v:0', '-vf', `select='gte(t,${time + origin - 1e-6})',showinfo`, '-frames:v', '1', '-fps_mode', 'vfr', '-q:v', '2', '-y', path], { signal, timeout: 60_000, maxBuffer: 1024 * 1024 });
    const pts = /\bn:\s*0\s+pts:\s*[-\d]+\s+pts_time:([-\d.]+)/.exec(decoded.stderr);
    if (!pts || !Number.isFinite(Number(pts[1]))) throw new AnalysisError('The object seed frame has no measured timestamp.', 422);
    const seedTime = Math.max(0, Number(pts[1]) - origin);
    const info = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', path], { signal, maxBuffer: 65536 });
    const { width, height } = frameInfo.parse(JSON.parse(info.stdout)).streams[0];
    const data = await readFile(path);
    let found: { box: z.infer<typeof trackBox>; provider: 'fal-florence-2' | 'gemini' } | undefined;
    const fal = configuredFal();
    let failure = 'Configure FAL_KEY on the media processor, or provide an inspected point or box.';
    if (fal) {
      try {
        const raw = await subscribe(fal, OBJECT_GROUNDING_ENDPOINT, { image_url: `data:image/jpeg;base64,${data.toString('base64')}`, text_input: noun }, signal);
        const boxes = grounding.parse(raw).results.bboxes;
        if (boxes.length !== 1) throw new AnalysisError('The noun was absent or matched multiple boxes. Choose an inspected source point or box.', 422);
        const candidate = boxes[0];
        found = { provider: 'fal-florence-2', box: trackBox.parse({ left: candidate.x / width, top: candidate.y / height, right: (candidate.x + candidate.w) / width, bottom: (candidate.y + candidate.h) / height }) };
      } catch (error) {
        signal.throwIfAborted();
        failure = error instanceof AnalysisError ? error.message : 'Object grounding failed. Check fal availability or provide an inspected source point or box.';
      }
    }
    if (!found) {
      const box = await optionalGeminiVision(signal, key => locateTrackingObject(data.toString('base64'), noun, key, signal));
      if (box) found = { provider: 'gemini', box };
    }
    if (!found) throw new AnalysisError(failure, 422, false);
    return { time: seedTime, ...found };
  } finally { await rm(path, { force: true }); }
}
