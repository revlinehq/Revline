import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { AnalysisError } from './errors';
import { parseShots, type ShotDetection } from './shots';

const run = promisify(execFile);
export async function detectShots(path: string, duration: number, signal: AbortSignal): Promise<ShotDetection> {
  const python = process.env.SCENE_DETECT_PYTHON || join(process.cwd(), '.data/scene-detection/bin/python');
  let stdout: string;
  try {
    ({ stdout } = await run(python, [join(process.cwd(), 'scripts/detect-shots.py'), path], { signal, timeout: 90_000, maxBuffer: 2 * 1024 * 1024 }));
  } catch (error) {
    if (signal.aborted) throw error;
    const detail = error as { code?: string; stderr?: string };
    if (detail.code === 'ENOENT' || detail.stderr?.includes('ModuleNotFoundError')) throw new AnalysisError('Shot detection is not configured. Install the pinned Python worker dependencies on the server.', 503);
    throw new AnalysisError('Could not detect shot changes in this video. Please try a shorter clip.', 502);
  }
  try { return parseShots(JSON.parse(stdout), duration); }
  catch (error) { if (error instanceof AnalysisError) throw error; throw new AnalysisError('Shot detection returned unreadable boundaries.', 502); }
}
