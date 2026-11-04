import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { z } from 'zod';
import { AnalysisError } from '../media-analysis/errors';
import { workerToolPath } from './worker-tool-path';

const number = z.number().finite();
const sample = z.object({ time: number, x: number, y: number, w: number.positive(), h: number.positive(), scale: number.positive(), rotation: number, confidence: number.min(0).max(1), visible: z.boolean(), opacity: number.min(0).max(1).optional(), opacityConfidence: number.min(0).max(1).optional(), sharpness: number.nonnegative().optional() });
const message = z.union([z.object({ sample }), z.object({ progress: number })]);
type Request = { start: number; end: number; box: { x: number; y: number; w: number; h: number }; frameTime?: number; backgroundTime?: number };

/** The processor's existing pinned OpenCV environment; no image processing runs in Convex. */
export async function trackReference(source: string, request: Request, signal: AbortSignal, progress: (percent: number) => void) {
  const python = workerToolPath(process.env.SCENE_DETECT_PYTHON, '.data/scene-detection/bin/python');
  const child = spawn(python, [join(process.cwd(), 'scripts/track-reference.py'), source, JSON.stringify(request)], { signal, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise<number | null>(resolve => child.once('close', resolve));
  let stderr = '', spawnError: Error | undefined;
  child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(-2000); });
  child.on('error', error => { spawnError = error; });
  const track: z.infer<typeof sample>[] = [];
  try {
    let buffer = '';
    for await (const data of child.stdout) {
      buffer += String(data);
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const value = message.parse(JSON.parse(line));
        if ('sample' in value) track.push(value.sample); else progress(value.progress);
      }
      if (buffer.length > 64_000) throw new Error('Oversized tracker message.');
    }
    const code = await closed;
    signal.throwIfAborted();
    if (spawnError || code !== 0 || buffer.trim() || !track.length) throw new Error(spawnError?.message ?? (stderr || 'Tracking ended without samples.'));
    return track.sort((a, b) => a.time - b.time);
  } catch (error) {
    child.kill('SIGTERM'); await closed;
    if (signal.aborted) throw error;
    throw new AnalysisError(`Element tracking failed. ${error instanceof Error ? error.message.slice(-2000) : String(error)}`, 422, false);
  }
}
