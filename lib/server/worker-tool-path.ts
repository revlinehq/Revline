import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

/** Worktree env files can contain paths copied from another checkout. */
export function workerToolPath(
  configured: string | undefined,
  local: string,
  fallback?: string,
) {
  const checkout = process.cwd();
  const data = configured?.replaceAll("\\", "/").match(/(?:^|\/)\.data\/(.+)$/);
  const candidate = data
    ? join(checkout, ".data", data[1])
    : configured
      ? resolve(checkout, configured)
      : undefined;
  if (candidate && existsSync(candidate)) return candidate;
  const bundled = join(checkout, local);
  if (existsSync(bundled) || !fallback) return bundled;
  return isAbsolute(fallback) ? resolve(fallback) : fallback;
}

/** Python with OpenCV and PySceneDetect: shots, facecam, speakers and reference tracking. */
export const sceneDetectPython = () =>
  workerToolPath(process.env.SCENE_DETECT_PYTHON, ".data/scene-detection/bin/python");

/** Python for the pixel tracker; defaults to the scene-detection environment. */
export const pixelTrackPython = () =>
  workerToolPath(process.env.PIXEL_TRACK_PYTHON || process.env.SCENE_DETECT_PYTHON, ".data/scene-detection/bin/python");

export const beatTrackPython = () =>
  workerToolPath(process.env.BEAT_TRACK_PYTHON, ".data/beat-tracking/bin/python");

export const beatTrackModelPath = () =>
  workerToolPath(process.env.BEAT_TRACK_MODEL_PATH, ".data/beat-tracking-models/hub/checkpoints/beat_this-final0.ckpt");

export const videoImporterPath = () =>
  workerToolPath(process.env.YT_DLP_PATH, ".data/video-import/bin/yt-dlp", "yt-dlp");
