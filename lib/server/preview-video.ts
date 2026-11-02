import { processingThreads } from './processing-resources';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run=promisify(execFile);
export type PreviewVideoMetadata={duration:number;width:number;height:number;fps:number};
type Probe={format?:{duration?:string};streams?:{codec_type?:string;codec_name?:string;width?:number;height?:number;avg_frame_rate?:string;r_frame_rate?:string;time_base?:string}[]};
const rate=(value:string|undefined)=>{const [numerator,denominator='1']=(value??'0').split('/').map(Number);return numerator/Number(denominator);};
async function probe(path:string,signal:AbortSignal){
  const {stdout}=await run('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,time_base','-of','json',path],{signal,timeout:30_000,maxBuffer:1024*1024});
  const value=JSON.parse(stdout) as Probe,video=value.streams?.find(stream=>stream.codec_type==='video');
  if(!video)throw new Error('Preview preparation needs a video source.');
  const duration=Number(value.format?.duration),fps=rate(video.avg_frame_rate)||rate(video.r_frame_rate),width=Number(video.width),height=Number(video.height);
  if(!Number.isFinite(duration)||duration<=0||!Number.isFinite(fps)||fps<=0||fps>240||!Number.isInteger(width)||width<=0||!Number.isInteger(height)||height<=0)throw new Error('The preview source has invalid video timing or geometry.');
  return {duration,width,height,fps,video,audio:value.streams?.find(stream=>stream.codec_type==='audio')};
}

export async function probePreviewVideo(path:string,signal:AbortSignal):Promise<PreviewVideoMetadata>{
  const {duration,width,height,fps}=await probe(path,signal);return {duration,width,height,fps};
}

/** A playback copy preserves source timestamps and every frame; exports keep the original. */
export async function preparePreviewVideo(input:string,output:string,signal:AbortSignal):Promise<PreviewVideoMetadata>{
  const source=await probe(input,signal),timeBase=source.video.time_base?.split('/').map(Number);
  if(!timeBase||timeBase.length!==2||!timeBase.every(value=>Number.isInteger(value)&&value>0)||timeBase[1]>2_147_483_647)throw new Error('The source video time base is unavailable.');
  const nominalFps=rate(source.video.r_frame_rate)||source.fps;
  const audio=source.audio?.codec_name==='aac'?['-c:a','copy']:['-c:a','aac','-b:a','160k'];
  // Autorotation produces upright pixels and scale never enlarges the source.
  // Keeping the demuxed time base and passthrough FPS preserves variable frame
  // timestamps. Do not add an FPS filter, output -r, or independently reset PTS.
  await run('ffmpeg',['-v','error','-threads',String(processingThreads()),'-copyts','-start_at_zero','-i',input,'-map','0:v:0','-map','0:a:0?',
    '-vf',"scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",'-filter_threads',String(processingThreads()),
    '-fps_mode','passthrough','-enc_time_base:v',timeBase.join('/'),'-video_track_timescale',String(timeBase[1]),
    '-c:v','libx264','-threads',String(processingThreads()),'-preset','veryfast','-b:v','3000k','-maxrate','3500k','-bufsize','7000k',
    '-g',String(Math.max(1,Math.ceil(nominalFps))),'-keyint_min','1','-sc_threshold','0','-force_key_frames','expr:gte(t,n_forced*1)',
    '-pix_fmt','yuv420p',...audio,'-movflags','+faststart','-y',output],{signal,timeout:12*60_000,maxBuffer:1024*1024});
  const result=await probePreviewVideo(output,signal);
  if(Math.abs(result.duration-source.duration)>.1)throw new Error('The prepared preview changed the source duration.');
  return result;
}
