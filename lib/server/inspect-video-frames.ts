import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { selectInspectionFrames, validateFrameInspectionInput, type FrameInspectionInput } from '../media-analysis/frame-inspection';
import { AnalysisError } from '../media-analysis/errors';
const run = promisify(execFile);

/** Decode real source frame PTS and indices; no invented evenly-spaced timestamps. */
export async function extractInspectionFrames(path: string, directory: string, input: FrameInspectionInput, duration: number, signal: AbortSignal) {
  validateFrameInspectionInput(input, duration);
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'format=start_time:stream=avg_frame_rate,r_frame_rate:frame=best_effort_timestamp_time', '-of', 'json', path], { signal, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  const data = JSON.parse(stdout) as { format?: { start_time?: string }; streams?: { avg_frame_rate?: string; r_frame_rate?: string }[]; frames?: { best_effort_timestamp_time?: string }[] };
  const ratio = (value?: string) => { const [a, b = '1'] = (value ?? '').split('/'); return Number(a) / Number(b); };
  const sourceFps = ratio(data.streams?.[0]?.avg_frame_rate) || ratio(data.streams?.[0]?.r_frame_rate);
  if (!Number.isFinite(sourceFps) || sourceFps <= 0) throw new AnalysisError('This source has no readable video frame rate.', 400);
  const origin = Number(data.format?.start_time ?? 0);
  const frames = (data.frames ?? []).map((frame, frameIndex) => ({ frameIndex, time: Number(frame.best_effort_timestamp_time) - origin })).filter(frame => Number.isFinite(frame.time));
  const selected = selectInspectionFrames(frames, input);
  const select = selected.map(frame => `eq(n,${frame.frameIndex})`).join('+');
  await run('ffmpeg', ['-v', 'error', '-i', path, '-map', '0:v:0', '-vf', `select='${select}',scale=960:960:force_original_aspect_ratio=decrease`, '-frames:v', String(selected.length), '-fps_mode', 'vfr', '-q:v', '4', '-y', join(directory, 'inspect-%02d.jpg')], { signal, timeout: 60_000, maxBuffer: 1024 * 1024 });
  const images = await Promise.all(selected.map(async (frame, index) => ({ ...frame, data: (await readFile(join(directory, `inspect-${String(index + 1).padStart(2, '0')}.jpg`))).toString('base64') })));
  if (images.reduce((bytes, image) => bytes + image.data.length, 0) > 12 * 1024 * 1024) throw new AnalysisError('Frame inspection images exceed the request size limit.', 400);
  return { sourceFps, images };
}
