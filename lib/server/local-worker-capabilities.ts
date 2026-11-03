import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import type { MediaWorkItem } from '../../convex/mediaTasks';
import { workerToolPath } from './worker-tool-path';

const run = promisify(execFile);
/** Check before subscribing/claiming: a missing dependency must not consume an attempt. */
export async function localWorkerCapabilities() {
  const excludedKinds = new Set<MediaWorkItem['kind']>();
  const missing: string[] = [];
  const available = async (label: string, file: string, args: string[]) => {
    try { await run(file, args, { timeout: 30_000, maxBuffer: 1024 * 1024 }); return true; }
    catch { missing.push(label); return false; }
  };
  const media = (await Promise.all(['ffmpeg', 'ffprobe'].map(file => available(file, file, ['-version'])))).every(Boolean);
  const scene = workerToolPath(process.env.SCENE_DETECT_PYTHON, '.data/scene-detection/bin/python');
  if (!await available('scene detection / OpenCV', scene, ['-c', 'import cv2, scenedetect'])) {
    for (const kind of ['facecam', 'speakers', 'shots', 'reference', 'derive'] as const) excludedKinds.add(kind);
  }
  const pixel = workerToolPath(process.env.PIXEL_TRACK_PYTHON || process.env.SCENE_DETECT_PYTHON, '.data/scene-detection/bin/python');
  if (pixel !== scene && !await available('pixel tracking / OpenCV', pixel, ['-c', 'import cv2'])) excludedKinds.add('derive');
  const beat = workerToolPath(process.env.BEAT_TRACK_PYTHON, '.data/beat-tracking/bin/python');
  const model = workerToolPath(process.env.BEAT_TRACK_MODEL_PATH, '.data/beat-tracking-models/hub/checkpoints/beat_this-final0.ckpt');
  if (!await available('Beat This', beat, ['-c', 'import beat_this, torch, torchaudio']) || !existsSync(model)) {
    excludedKinds.add('beats'); excludedKinds.add('reference');
    if (!existsSync(model)) missing.push('Beat This model');
  }
  const importer = workerToolPath(process.env.YT_DLP_PATH, '.data/video-import/bin/yt-dlp', 'yt-dlp');
  if (!await available('video importer', importer, ['--version'])) excludedKinds.add('import');
  return { media, excludedKinds: [...excludedKinds], missing };
}
