import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { AnalysisError } from '../media-analysis/errors';
import { parsePixelTrackResult, pixelTrackRequest, type PixelTrackRequest } from '../media-analysis/pixel-track';
const run = promisify(execFile);

/** CPU tracking runs in the processor, with bounded memory and no model downloads. */
export async function trackSourcePixels(source: string, request: PixelTrackRequest, signal: AbortSignal) {
  const input = pixelTrackRequest.parse(request);
  const python = process.env.PIXEL_TRACK_PYTHON || process.env.SCENE_DETECT_PYTHON || join(process.cwd(), '.data/scene-detection/bin/python');
  try {
    const { stdout } = await run(python, [join(process.cwd(), 'scripts/track-pixels.py'), source, JSON.stringify(input)], { signal, timeout: 240_000, maxBuffer: 3 * 1024 * 1024 });
    return parsePixelTrackResult(JSON.parse(stdout), input);
  } catch (error) {
    if (signal.aborted) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new AnalysisError(`Pixel tracking failed. Check the seed is visible and textured, or choose a shorter window. ${detail.slice(-600)}`, 502, false);
  }
}
