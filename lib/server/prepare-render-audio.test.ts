import {execFile} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {expect,it} from 'vitest';
import {prepareRenderAudioSource} from './prepare-render-audio';

const run=promisify(execFile);
it('keeps AAC source samples continuous through the native mixer input seeks at split boundaries',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'revline-aac-seek-'));
  try{
    const source=join(directory,'source.m4a');
    await run('ffmpeg',['-v','error','-f','lavfi','-i','aevalsrc=0.3*sin(2*PI*883.7*t)+0.1*sin(2*PI*1291.1*t):s=22050:d=10','-c:a','aac','-b:a','128k','-y',source]);
    const prepared=(await prepareRenderAudioSource(source,join(directory,'decoded.wav'),AbortSignal.timeout(10000))).path;
    const decode=async(path:string,start?:number,duration?:number)=>{
      const {stdout}=await run('ffmpeg',['-v','error',...(start===undefined?[]:['-ss',String(start),'-t',String(duration)]),'-i',path,'-ar','48000','-f','f32le','-'],{encoding:'buffer',maxBuffer:3*1024*1024});
      return new Float32Array(stdout.buffer,stdout.byteOffset,stdout.byteLength/4);
    };
    const reference=await decode(source),split=new Float32Array(480000);let offset=0;
    for(const [start,end]of [[0,3],[3,5],[5,7],[7,10]]){const samples=await decode(prepared,start,end-start);expect(samples.length).toBe((end-start)*48000);split.set(samples,offset);offset+=samples.length;}
    for(const time of [3,5,5.1,7]){let error=0,energy=0;for(let sample=Math.round((time-.05)*48000);sample<Math.round((time+.05)*48000);sample++){error+=(split[sample]-reference[sample])**2;energy+=reference[sample]**2;}expect(Math.sqrt(error/energy),`AAC discontinuity near ${time}s`).toBeLessThan(.01);}
  }finally{await rm(directory,{recursive:true,force:true});}
},15000);

it('keeps compatible stereo PCM on disk without decoding it again',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'revline-pcm-render-'));
  try{
    const source=join(directory,'stereo.wav');
    await run('ffmpeg',['-v','error','-f','lavfi','-i','aevalsrc=0.2*sin(2*PI*440*t)|0.2*sin(2*PI*880*t):s=48000:d=0.2','-c:a','pcm_s16le','-y',source]);
    const prepared=await prepareRenderAudioSource(source,join(directory,'unused.wav'),AbortSignal.timeout(10000));
    expect(prepared).toMatchObject({path:source,decoded:false});
  }finally{await rm(directory,{recursive:true,force:true});}
});

it('reports unreadable and silent sources explicitly and respects cancellation',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'revline-audio-unavailable-'));
  try{
    await expect(prepareRenderAudioSource(join(directory,'missing.m4a'),join(directory,'decoded.wav'),AbortSignal.timeout(10000))).rejects.toMatchObject({message:'Export audio source could not be decoded.',status:422});
    const source=join(directory,'silent.mp4');await run('ffmpeg',['-v','error','-f','lavfi','-i','color=blue:s=16x16:r=1:d=0.2','-an','-c:v','libx264','-y',source]);
    await expect(prepareRenderAudioSource(source,join(directory,'decoded.wav'),AbortSignal.timeout(10000))).rejects.toMatchObject({message:'Export source has no decodable audio.',status:422});
    const controller=new AbortController();controller.abort(new Error('Cancelled export'));
    await expect(prepareRenderAudioSource(source,join(directory,'decoded.wav'),controller.signal)).rejects.toThrow('Cancelled export');
  }finally{await rm(directory,{recursive:true,force:true});}
});
