import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findFfBinary } from '@hyperframes/parsers/ff-binaries';

/** Bound native decoder work while preserving HyperFrames' process ownership. */
export function configureRenderFfmpeg(directory) {
  // The deployed media worker and local Linux development use util-linux flock.
  if (process.platform !== 'linux') return;
  execFileSync('flock', ['--version'], { stdio: 'ignore', timeout: 5000 });
  const binary = findFfBinary('ffmpeg');
  if (!binary) throw new Error('FFmpeg is unavailable for video export.');
  process.env.REVLINE_RENDER_FFMPEG_BINARY = binary;
  process.env.REVLINE_RENDER_FFMPEG_LOCK = join(directory, '.render-ffmpeg.lock');
  process.env.HYPERFRAMES_FFMPEG_PATH = fileURLToPath(new URL('./render-ffmpeg.sh', import.meta.url));
}
