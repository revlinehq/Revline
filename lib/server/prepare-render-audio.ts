import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {AnalysisError} from '@/lib/media-analysis/errors';

const run=promisify(execFile);
const seekSafePcm=new Set(['pcm_s16le','pcm_s24le','pcm_s32le','pcm_f32le','pcm_f64le']);

/** Decode compressed sound once per export; native per-clip seeks then use PCM sample offsets. */
export async function prepareRenderAudioSource(input:string,output:string,signal:AbortSignal) {
  signal.throwIfAborted();
  const started=performance.now();
  try {
    const {stdout}=await run('ffprobe',['-v','error','-select_streams','a:0','-show_entries','stream=codec_name:format=format_name','-of','json',input],{signal,timeout:30_000,maxBuffer:1024*1024});
    const metadata=JSON.parse(stdout) as {streams?:{codec_name:string}[];format?:{format_name:string}};
    const codec=metadata.streams?.[0]?.codec_name;
    if(!codec)throw new AnalysisError('Export source has no decodable audio.',422);
    if(metadata.format?.format_name==='wav'&&seekSafePcm.has(codec))return {path:input,decoded:false,elapsedMs:performance.now()-started};
    // Disk output preserves channel layout and original source time. No whole-file PCM buffer.
    await run('ffmpeg',['-v','error','-threads','1','-i',input,'-map','0:a:0','-vn','-c:a','pcm_s16le','-ar','48000','-rf64','auto','-y',output],{signal,timeout:180_000,maxBuffer:1024*1024});
    return {path:output,decoded:true,elapsedMs:performance.now()-started};
  } catch(error) {
    if(signal.aborted||error instanceof AnalysisError)throw error;
    throw new AnalysisError('Export audio source could not be decoded.',422);
  }
}
