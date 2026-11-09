import { ffmpegTime } from '../ffmpeg-time.mjs';
import { mediaInputOptions } from './media-command';
import { runMediaCommand as run } from './media-command';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { previewResources } from './processing-resources';
import { previewChunkBoundaries } from './preview-chunks';
import { resolve } from 'node:path';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { z } from 'zod';
import { forEachLimited } from './run-limited';
import { previewChunks } from '../editor/preview-segments';
import type { SourceRange } from '../editor/types';

const streamSchema = z.object({
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  pix_fmt: z.string().optional(),
  side_data_list: z.array(z.object({ rotation: z.number().optional() })).optional(),
  tags: z.object({ rotate: z.string().optional() }).optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  avg_frame_rate: z.string().optional(),
  r_frame_rate: z.string().optional(),
  time_base: z.string().optional(),
});
const probeSchema = z.object({
  format: z
    .object({
      duration: z.string().optional(),
      format_name: z.string().optional(),
      bit_rate: z.string().optional(),
      start_time: z.string().optional(),
    })
    .optional(),
  streams: z.array(streamSchema).optional(),
});
export type PreviewVideoMetadata = {
  duration: number;
  width: number;
  height: number;
  fps: number;
};
const rate = (value: string | undefined) => {
  const [numerator, denominator = 1] = (value ?? '0').split('/').map(Number);
  return numerator / denominator;
};
export async function inspectPreviewVideo(path: string, signal: AbortSignal) {
  const { stdout } = await run(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration,format_name,bit_rate,start_time:stream=codec_type,codec_name,pix_fmt,width,height,avg_frame_rate,r_frame_rate,time_base:stream_side_data=rotation:stream_tags=rotate',
      '-of',
      'json',
      path,
    ],
    { signal, timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  const value = probeSchema.parse(JSON.parse(stdout)),
    video = value.streams?.find((stream) => stream.codec_type === 'video');
  if (!video) throw new Error('Preview preparation needs a video source.');
  const duration = Number(value.format?.duration),
    fps = rate(video.avg_frame_rate) || rate(video.r_frame_rate),
    width = Number(video.width),
    height = Number(video.height);
  const rotation = Number(
    video.side_data_list?.find((item) => item.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0,
  );
  const rotated = Math.abs(rotation % 180) === 90;
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(fps) ||
    fps <= 0 ||
    fps > 240 ||
    !Number.isInteger(width) ||
    width <= 0 ||
    !Number.isInteger(height) ||
    height <= 0
  )
    throw new Error('The preview source has invalid video timing or geometry.');
  const audio = value.streams?.find((stream) => stream.codec_type === 'audio');
  const compatible =
    video.codec_name === 'h264' &&
    video.pix_fmt === 'yuv420p' &&
    (!audio || audio.codec_name === 'aac') &&
    !!value.format?.format_name?.includes('mp4');
  const originalPlayable =
    compatible && Math.max(width, height) <= 3840 && Number(value.format?.bit_rate ?? 0) <= 40_000_000;
  return {
    duration,
    width: rotated ? height : width,
    height: rotated ? width : height,
    fps,
    video,
    audio,
    compatible,
    originalPlayable,
    origin: Number(value.format?.start_time ?? 0),
  };
}
export async function probePreviewVideo(path: string, signal: AbortSignal): Promise<PreviewVideoMetadata> {
  const { duration, width, height, fps } = await inspectPreviewVideo(path, signal);
  return { duration, width, height, fps };
}

/** FFmpeg's video packet PTS gives real progress even when copyts makes out_time_us relative to a seek. */
async function runPreviewFfmpeg(
  args: string[],
  signal: AbortSignal,
  onSeconds: (seconds: number) => void,
  encoding = false,
) {
  await new Promise<void>((resolve, reject) => {
    const stats = encoding
      ? ['-stats_enc_post:v', 'pipe:1', '-stats_enc_post_fmt', '{t}']
      : ['-progress', 'pipe:1', '-stats_period', '0.5'];
    const child = spawn('ffmpeg', ['-v', 'error', '-nostdin', ...args.slice(0, -1).flatMap((arg, i) => arg === '-i' ? [...mediaInputOptions(args[i + 1]), arg] : [arg]), ...stats, args.at(-1)!], {
      signal,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let pending = '',
      stderr = '',
      reported = -Infinity;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      pending += data;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const seconds = encoding ? Number(line) : line.startsWith('out_time_us=') ? Number(line.slice(12)) / 1e6 : NaN;
        if (line.trim() && Number.isFinite(seconds) && seconds >= reported + 0.1) {
          reported = seconds;
          onSeconds(seconds);
        }
      }
    });
    child.stderr.on('data', (data: string) => {
      stderr = (stderr + data).slice(-8192);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Preview encoding failed (${code}): ${stderr}`)),
    );
  });
}

async function previewEncoder(signal: AbortSignal) {
  if (platform() === 'darwin' && process.env.MEDIA_PREVIEW_HARDWARE !== '0') {
    // Listing an encoder does not prove that this worker can open a hardware session.
    try {
      await run(
        'ffmpeg',
        [
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          'color=size=64x64:rate=1',
          '-frames:v',
          '1',
          '-c:v',
          'h264_videotoolbox',
          '-allow_sw',
          '0',
          '-f',
          'null',
          '-',
        ],
        { signal, timeout: 10_000, maxBuffer: 64 * 1024 },
      );
      return 'h264_videotoolbox';
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }
  return 'libx264';
}

export async function extractPreviewPoster(input: string, output: string, signal: AbortSignal, time = 0.5) {
  await run(
    'ffmpeg',
    [
      '-v',
      'error',
      '-nostdin',
      '-threads',
      '1',
      '-ss',
      ffmpegTime(time),
      '-i',
      input,
      '-frames:v',
      '1',
      '-vf',
      'scale=352:352:force_original_aspect_ratio=decrease',
      '-q:v',
      '5',
      '-y',
      output,
    ],
    { signal, timeout: 30_000, maxBuffer: 64 * 1024 },
  );
  return readFile(output);
}

/** Scan packet headers only. A long GOP needs a derivative; adding keyframes requires re-encoding. */
async function hasScrubbableKeyframes(input: string, signal: AbortSignal, duration: number) {
  const starts = [...new Set([0, Math.max(0, duration / 2 - 15), Math.max(0, duration - 30)])];
  for (const start of starts) {
    const end = Math.min(duration, start + 30);
    const { stdout } = await run(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-skip_frame',
        'nokey',
        '-read_intervals',
        `${start}%${end}`,
        '-show_frames',
        '-show_entries',
        'frame=best_effort_timestamp_time',
        '-of',
        'csv=p=0',
        input,
      ],
      { signal, timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    const times = stdout
      .split('\n')
      .map((line) => Number.parseFloat(line))
      .filter(Number.isFinite);
    if (
      !times.length ||
      times[0] > start + 10 ||
      times.at(-1)! < end - 10 ||
      times.some((time, index) => index > 0 && time - times[index - 1] > 10.1)
    )
      return false;
  }
  return true;
}

type EncodeOptions = {
  encoder: string;
  threads: number;
  source: Awaited<ReturnType<typeof inspectPreviewVideo>>;
};
async function encodePreviewRange(
  input: string,
  output: string,
  range: SourceRange,
  signal: AbortSignal,
  onSeconds: (seconds: number) => void,
  options: EncodeOptions,
): Promise<void> {
  const { source, threads, encoder } = options,
    timeBase = source.video.time_base?.split('/').map(Number);
  if (
    !timeBase ||
    timeBase.length !== 2 ||
    !timeBase.every((value) => Number.isInteger(value) && value > 0) ||
    timeBase[1] > 2_147_483_647
  )
    throw new Error('The source video time base is unavailable.');
  const long = source.duration >= 600,
    shortSide = long ? 540 : 720,
    longSide = long ? 960 : 1280;
  const encoderArgs =
    encoder === 'h264_videotoolbox'
      ? ['-c:v', encoder, '-allow_sw', '0', '-b:v', long ? '2500k' : '4000k']
      : ['-c:v', 'libx264', '-threads', String(threads), '-preset', 'superfast', '-crf', '22'];
  try {
    await runPreviewFfmpeg(
      [
        ...(encoder === 'h264_videotoolbox' && ['h264', 'hevc'].includes(source.video.codec_name ?? '')
          ? ['-hwaccel', 'videotoolbox']
          : []),
        '-threads',
        String(threads),
        '-ss',
        ffmpegTime(range.start),
        '-copyts',
        '-start_at_zero',
        '-i',
        input,
        '-to',
        ffmpegTime(range.end),
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-vf',
        `scale=w='if(gte(iw,ih),min(${longSide},iw),min(${shortSide},iw))':h='if(gte(iw,ih),min(${shortSide},ih),min(${longSide},ih))':force_original_aspect_ratio=decrease:force_divisible_by=2`,
        '-filter_threads',
        String(threads),
        '-fps_mode',
        'passthrough',
        '-enc_time_base:v',
        timeBase.join('/'),
        '-video_track_timescale',
        String(timeBase[1]),
        '-movie_timescale',
        String(timeBase[1]),
        ...encoderArgs,
        '-g',
        String(Math.max(1, Math.ceil(rate(source.video.r_frame_rate) || source.fps))),
        '-keyint_min',
        '1',
        '-sc_threshold',
        '0',
        '-force_key_frames',
        'expr:if(isnan(prev_forced_t),1,gte(t,prev_forced_t+1))',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '160k',
        '-output_ts_offset',
        String(-range.start),
        '-avoid_negative_ts',
        'disabled',
        '-movflags',
        '+faststart',
        '-y',
        output,
      ],
      signal,
      (seconds) => onSeconds(Math.min(range.end - range.start, Math.max(0, seconds - range.start))),
      true,
    );
  } catch (error) {
    if (encoder === 'h264_videotoolbox' && !signal.aborted)
      return encodePreviewRange(input, output, range, signal, onSeconds, { ...options, encoder: 'libx264' });
    throw error;
  }
}

async function remuxPreviewVideo(
  input: string,
  output: string,
  signal: AbortSignal,
  onSeconds: (seconds: number) => void,
) {
  await runPreviewFfmpeg(
    [
      '-copyts',
      '-start_at_zero',
      '-i',
      input,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      '-y',
      output,
    ],
    signal,
    onSeconds,
  );
}

/** Exact chunk durations retain VFR PTS. Audio is taken once from the original, avoiding AAC priming at joins. */
async function concatenatePreview(
  input: string,
  output: string,
  chunks: (SourceRange & { path: string })[],
  signal: AbortSignal,
) {
  const manifest = `${output}.concat`,
    source = await inspectPreviewVideo(input, signal);
  const timescale = source.video.time_base?.split('/')[1] ?? '90000';
  await writeFile(
    manifest,
    chunks
      .map(
        (chunk) =>
          `file '${resolve(chunk.path).replace(/'/g, "'\\''")}'\ninpoint 0\nduration ${(chunk.end - chunk.start).toFixed(9)}`,
      )
      .join('\n'),
  );
  try {
    await run(
      'ffmpeg',
      [
        '-v',
        'error',
        '-nostdin',
        '-copyts',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        manifest,
        '-itsoffset',
        ffmpegTime(-source.origin),
        '-i',
        input,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0?',
        '-c:v',
        'copy',
        ...(source.audio?.codec_name === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '160k']),
        '-avoid_negative_ts',
        'disabled',
        '-movie_timescale',
        timescale,
        '-movflags',
        '+faststart',
        '-y',
        output,
      ],
      { signal, timeout: 600_000, maxBuffer: 1024 * 1024 },
    );
  } finally {
    await rm(manifest, { force: true });
  }
}

type PreviewPreparationOptions = {
  source?: Awaited<ReturnType<typeof inspectPreviewVideo>>;
  ranges?: SourceRange[];
  currentRanges?(): Promise<SourceRange[]>;
  reuseSegment?(path: string, range: SourceRange, signal: AbortSignal): Promise<boolean>;
  onSegment?(path: string, range: SourceRange, signal: AbortSignal): Promise<void>;
};

export async function preparePreviewVideo(
  input: string,
  output: string,
  signal: AbortSignal,
  onProgress: (percent: number) => void = () => {},
  options: PreviewPreparationOptions = {},
): Promise<PreviewVideoMetadata> {
  const source = options.source ?? (await inspectPreviewVideo(input, signal));
  if (source.originalPlayable && (await hasScrubbableKeyframes(input, signal, source.duration))) {
    await remuxPreviewVideo(input, output, signal, (seconds) =>
      onProgress(Math.min(100, (seconds / source.duration) * 100)),
    );
  } else {
    const encoder = await previewEncoder(signal),
      ranges = options.ranges ?? [];
    const boundaries = await previewChunkBoundaries(input, source, signal, ranges),
      { priority, background } = previewChunks(source.duration, ranges, boundaries);
    const chunks = [...priority, ...background].map((range, index) => ({ ...range, path: `${output}.${index}.mp4` }));
    const { parallel, threads } = previewResources(chunks.length);
    const priorityStarts = new Set(priority.map((range) => range.start)),
      total = priority.reduce((sum, range) => sum + range.end - range.start, 0),
      progress = new Map<number, number>();
    const report = (chunk: SourceRange, seconds: number) => {
      if (!priorityStarts.has(chunk.start)) return;
      progress.set(chunk.start, seconds);
      onProgress(([...progress.values()].reduce((sum, value) => sum + value, 0) / total) * 100);
    };
    const encode = async (chunk: (typeof chunks)[number], stop: AbortSignal) => {
      const currentSignal = AbortSignal.any([signal, stop]);
      const reused = (await options.reuseSegment?.(chunk.path, chunk, currentSignal)) ?? false;
      if (!reused) {
        await encodePreviewRange(input, chunk.path, chunk, currentSignal, (seconds) => report(chunk, seconds), {
          source,
          encoder,
          threads,
        });
        await options.onSegment?.(chunk.path, { start: chunk.start, end: chunk.end }, currentSignal);
      }
      report(chunk, chunk.end - chunk.start);
    };
    try {
      await forEachLimited(
        chunks.filter((chunk) => priorityStarts.has(chunk.start)),
        parallel,
        encode,
      );
      const remaining = chunks.filter((chunk) => !priorityStarts.has(chunk.start));
      while (remaining.length) {
        const current = (await options.currentRanges?.()) ?? ranges;
        const urgent = (chunk: SourceRange) =>
          current.some((range) => chunk.end > range.start - 2 && chunk.start < range.end + 2);
        remaining.sort((a, b) => Number(urgent(b)) - Number(urgent(a)) || a.start - b.start);
        await forEachLimited(remaining.splice(0, parallel), parallel, encode);
      }
      await concatenatePreview(
        input,
        output,
        chunks.sort((a, b) => a.start - b.start),
        signal,
      );
    } finally {
      await Promise.all(chunks.map((chunk) => rm(chunk.path, { force: true })));
    }
  }
  const result = await probePreviewVideo(output, signal);
  if (Math.abs(result.duration - source.duration) > 0.1)
    throw new Error('The prepared preview changed the source duration.');
  onProgress(100);
  return result;
}
