import {execFile} from 'node:child_process';
import {copyFile,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {expect,it} from 'vitest';
import type {MediaAsset,Timeline} from '../editor/types';
import {writeComposition} from './prepare-composition';

const run=promisify(execFile);
it('omits silent video from native export audio without muting embedded or separate sound',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'revline-silent-composition-'));
  try{
    await copyFile(join(process.cwd(),'public/demo/landing/nasa.mp4'),join(directory,'silent.mp4'));
    await run('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=64x36:r=24:d=0.5','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=0.5','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest','-y',join(directory,'audible.mp4')]);
    await run('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=0.5','-c:a','pcm_s16le','-y',join(directory,'sound.wav')]);
    const assets:MediaAsset[]=[
      {_id:'silent',fileName:'silent.mp4',kind:'video',url:null,width:1280,height:720},
      {_id:'audible',fileName:'audible.mp4',kind:'video',url:null,width:64,height:36},
      {_id:'sound',fileName:'sound.wav',kind:'audio',url:null},
    ];
    const timeline:Timeline={fps:24,aspectRatio:'landscape',clips:[
      {id:'silent-1',kind:'video',assetId:'silent',start:0,duration:.25,sourceStart:1,volume:1},
      {id:'silent-2',kind:'video',assetId:'silent',start:.25,duration:.25,sourceStart:4,volume:1},
      {id:'embedded',kind:'video',assetId:'audible',start:.5,duration:.5,sourceStart:0,volume:.3},
      {id:'separate',kind:'audio',assetId:'sound',start:0,duration:.5,sourceStart:0,volume:.7},
    ]};
    const before=structuredClone(timeline);
    await writeComposition(directory,timeline,assets,{silent:'./silent.mp4',audible:'./audible.mp4',sound:'./sound.wav'},720,24);
    const html=await readFile(join(directory,'index.html'),'utf8');
    const videos=html.match(/<video\b[^>]*>/g)??[];
    expect(videos).toHaveLength(3);
    for(const id of ['silent-1','silent-2']){
      const tag=videos.find(value=>value.includes(`data-source-clip="${id}"`));
      expect(tag).toContain('data-volume="0"');expect(tag).toMatch(/\s+muted(?:\s|>)/);
    }
    const embedded=videos.find(value=>value.includes('data-source-clip="embedded"'));
    expect(embedded).toContain('data-volume="0.3"');expect(embedded).not.toMatch(/\s+muted(?:\s|>)/);
    expect(html.match(/<audio\b[^>]*>/g)).toEqual([expect.stringContaining('data-volume="0.7"')]);
    expect(timeline).toEqual(before);
  }finally{await rm(directory,{recursive:true,force:true});}
},15000);
