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

it('exports a clip section at zero with its overlapping sound, text and original animation phase',async()=>{
  const {clipExportTimeline}=await import('../editor/clip-export');
  const timeline:Timeline={fps:30,aspectRatio:'landscape',clips:[
    {id:'before',kind:'video',assetId:'video',start:0,duration:4,sourceStart:0},
    {id:'selected',kind:'video',assetId:'video',start:4,duration:3,sourceStart:6,playbackRate:2,linkedClipId:'sound',audioSeparated:true},
    {id:'sound',kind:'audio',assetId:'sound',start:4,duration:3,sourceStart:6,playbackRate:2,linkedClipId:'selected'},
    {id:'music',kind:'audio',assetId:'music',track:2,start:0,duration:10,sourceStart:1,playbackRate:.5,audio:{role:'music',fadeIn:2,fadeOut:2,ducking:{enabled:false,amount:.65,attack:.12,release:.25}}},
    {id:'text',kind:'caption',text:'Keep this',track:2,start:3,duration:5,sourceStart:0,motion:[{time:0,x:0,y:0,scale:1,rotation:0,opacity:1,brightness:1},{time:5,x:1,y:0,scale:1,rotation:0,opacity:1,brightness:1}]},
    {id:'after',kind:'video',assetId:'video',start:7,duration:2,sourceStart:12},
  ],markers:[{id:'inside',time:5},{id:'outside',time:8}]};
  const before=structuredClone(timeline),result=clipExportTimeline(timeline,'selected');
  expect(result.clips.find(clip=>clip.id==='selected')).toMatchObject({start:0,duration:3,sourceStart:6,playbackRate:2});
  expect(result.clips.find(clip=>clip.id==='sound')).toMatchObject({start:0,duration:3,sourceStart:6,linkedClipId:'selected'});
  expect(result.clips.find(clip=>clip.id==='music')).toMatchObject({start:0,duration:3,sourceStart:3,audioFadeTiming:{duration:10,offset:4}});
  expect(result.clips.find(clip=>clip.id==='text')).toMatchObject({start:0,duration:3,motionOffset:1});
  expect(result.clips.map(clip=>clip.id)).toEqual(['selected','sound','music','text']);
  expect(result.markers).toEqual([{id:'inside',time:1}]);expect(timeline).toEqual(before);
  expect(()=>clipExportTimeline(timeline,'missing')).toThrow('existing footage');
});
