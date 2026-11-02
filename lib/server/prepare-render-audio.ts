import {execFile} from 'node:child_process';
import {statfs} from 'node:fs/promises';
import {dirname} from 'node:path';
import {promisify} from 'node:util';
import {AnalysisError} from '@/lib/media-analysis/errors';

const run=promisify(execFile);
const seekSafePcm=new Set(['pcm_s16le','pcm_s24le','pcm_s32le','pcm_f32le','pcm_f64le']);
const SAMPLE_RATE=48_000;
export type RenderAudioWindow={start:number;end:number};

/** Decode compressed sound once per export; native per-clip seeks then use PCM sample offsets. */
export async function prepareRenderAudioSource(input:string,output:string,signal:AbortSignal,window?:RenderAudioWindow) {
  signal.throwIfAborted();
  const started=performance.now();
  try {
    const {stdout}=await run('ffprobe',['-v','error','-select_streams','a:0','-show_entries','stream=codec_name,channels:format=format_name,duration','-of','json',input],{signal,timeout:30_000,maxBuffer:1024*1024});
    const metadata=JSON.parse(stdout) as {streams?:{codec_name:string;channels:number}[];format?:{format_name:string;duration:string}};
    const codec=metadata.streams?.[0]?.codec_name;
    if(!codec)throw new AnalysisError('Export source has no decodable audio.',422);
    if(!window&&metadata.format?.format_name==='wav'&&seekSafePcm.has(codec))return {path:input,decoded:false,sourceStart:0,elapsedMs:performance.now()-started};
    const duration=Number(metadata.format?.duration),channels=metadata.streams?.[0]?.channels??0;
    if(!Number.isFinite(duration)||duration<=0||!Number.isSafeInteger(channels)||channels<1)throw new AnalysisError('Export audio source has unsupported duration or channels.',422);
    const start=window?.start??0,end=Math.min(window?.end??duration,duration);
    if(!Number.isFinite(start)||start<0||!Number.isFinite(end)||end<=start)throw new AnalysisError('Export audio source window is invalid.',422);
    const sampleCount=Math.ceil((end-start)*SAMPLE_RATE);
    const disk=await statfs(dirname(output));
    if(sampleCount*channels*2+1024*1024*1024>disk.bavail*disk.bsize)throw new AnalysisError('The render server needs more temporary disk space for this audio section.',503);
    // Integer-second preroll keeps resampling phase stable across an AAC seek.
    // Trim in the output sample clock and return the new file's source origin.
    const seek=Math.max(0,Math.floor(start)-1),skip=Math.round((start-seek)*SAMPLE_RATE);
    const inputWindow=window?['-ss',String(seek),'-t',String(end-seek+.1)]:[];
    const filter=window?['-af',`aresample=${SAMPLE_RATE},atrim=start_sample=${skip}:end_sample=${skip+sampleCount},asetpts=PTS-STARTPTS`]:[];
    await run('ffmpeg',['-v','error','-threads','1',...inputWindow,'-i',input,'-map','0:a:0','-vn',...filter,'-c:a','pcm_s16le','-ar',String(SAMPLE_RATE),'-rf64','auto','-y',output],{signal,maxBuffer:1024*1024});
    return {path:output,decoded:true,sourceStart:start,elapsedMs:performance.now()-started};
  } catch(error) {
    if(signal.aborted||error instanceof AnalysisError)throw error;
    throw new AnalysisError('Export audio source could not be decoded.',422);
  }
}
