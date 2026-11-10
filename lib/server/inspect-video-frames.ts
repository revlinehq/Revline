import { ffmpegTime } from '../ffmpeg-time.mjs';
import { runMediaCommand as run } from './media-command';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { selectInspectionFrames, validateFrameInspectionInput, type FrameInspectionInput } from '../media-analysis/frame-inspection';
import { AnalysisError } from '../media-analysis/errors';

/** Decode real source frame PTS and indices; no invented evenly-spaced timestamps. */
export async function extractInspectionFrames(path: string, directory: string, input: FrameInspectionInput, duration: number, signal: AbortSignal) {
  validateFrameInspectionInput(input, duration);
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'format=start_time:stream=avg_frame_rate,r_frame_rate,width,height:stream_tags=rotate:stream_side_data=rotation', '-of', 'json', path], { signal, timeout: 30_000, maxBuffer: 1024 * 1024 });
  const data = JSON.parse(stdout) as { format?: { start_time?: string }; streams?: { avg_frame_rate?: string; r_frame_rate?: string; width?:number;height?:number;tags?:{rotate?:string};side_data_list?:{rotation?:number}[] }[]; frames?: { best_effort_timestamp_time?: string }[] };
  const ratio = (value?: string) => { const [a, b = '1'] = (value ?? '').split('/'); return Number(a) / Number(b); };
  const sourceFps = ratio(data.streams?.[0]?.avg_frame_rate) || ratio(data.streams?.[0]?.r_frame_rate);
  if (!Number.isFinite(sourceFps) || sourceFps <= 0) throw new AnalysisError('This source has no readable video frame rate.', 400);
  const origin = Number(data.format?.start_time ?? 0);
  if(!Number.isFinite(origin))throw new AnalysisError('This source has no readable video time origin.',400);
  // Preserve global decoded-frame ordinals for VFR/consecutive evidence. Count
  // the prefix, but stop after this window rather than probing the source tail.
  const {stdout:timestamps}=await run('ffprobe',['-v','error','-select_streams','v:0','-read_intervals',`%${origin+input.end+1}`,'-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',path],{signal,timeout:60_000,maxBuffer:8*1024*1024});
  const decodedFrames=JSON.parse(timestamps) as {frames?:{best_effort_timestamp_time?:string}[]};
  const frames = (decodedFrames.frames ?? []).map((frame, frameIndex) => ({ frameIndex, time: Number(frame.best_effort_timestamp_time) - origin })).filter(frame => Number.isFinite(frame.time));
  const selected = selectInspectionFrames(frames, input);
  // FFprobe prints microsecond PTS. Match those measured instants after seeking;
  // local decoder indices or average-FPS arithmetic would relabel VFR frames.
  const select = selected.map(frame => `between(t,${frame.time+origin-1e-6},${frame.time+origin+1e-6})`).join('+'),seek=Math.max(0,input.start-.5);
  await run('ffmpeg', ['-v', 'error', '-copyts','-ss',ffmpegTime(seek),'-t',ffmpegTime(input.end-seek+1),'-i', path, '-map', '0:v:0', '-vf', `select='${select}',scale=960:960:force_original_aspect_ratio=decrease`, '-frames:v', String(selected.length), '-fps_mode', 'vfr', '-q:v', '4', '-y', join(directory, 'inspect-%02d.jpg')], { signal, timeout: 60_000, maxBuffer: 1024 * 1024 });
  const images = await Promise.all(selected.map(async (frame, index) => ({ ...frame, data: (await readFile(join(directory, `inspect-${String(index + 1).padStart(2, '0')}.jpg`))).toString('base64') })));
  if (images.reduce((bytes, image) => bytes + image.data.length, 0) > 12 * 1024 * 1024) throw new AnalysisError('Frame inspection images exceed the request size limit.', 400);
  const {stdout:decoded}=await run('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',join(directory,'inspect-01.jpg')],{signal,timeout:10000,maxBuffer:65536});
  const decodedStream=(JSON.parse(decoded) as {streams?:{width:number;height:number}[]}).streams?.[0],stream=data.streams?.[0];
  if(!decodedStream||!stream?.width||!stream.height)throw new AnalysisError('Decoded frame dimensions are unavailable.',400);
  const rotation=Number(stream.side_data_list?.find(item=>item.rotation!==undefined)?.rotation??stream.tags?.rotate??0);
  const portrait=Math.abs(rotation%180)===90;
  const geometry={sourceWidth:portrait?stream.height:stream.width,sourceHeight:portrait?stream.width:stream.height,decodedWidth:decodedStream.width,decodedHeight:decodedStream.height};
  return { sourceFps, images,geometry };
}

