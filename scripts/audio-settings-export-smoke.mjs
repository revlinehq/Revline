import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseAudioElements,processCompositionAudio} from '@hyperframes/engine';
import {parseAutomation,sampleAutomationLane} from '@hyperframes/core/audio-automation';
import {fadeGain} from '@hyperframes/core/audio-fade';

const directory=await mkdtemp(join(tmpdir(),'revline-audio-settings-'));
try{
  const helper=join(directory,'audio.mjs');
  await build({entryPoints:['lib/editor/audio-settings.ts'],outfile:helper,bundle:true,platform:'node',format:'esm'});
  const {audioSettings,audioVolumeEnvelope,DEFAULT_AUDIO_SETTINGS}=await import(pathToFileURL(helper).href);
  for(const [name,hz] of [['music',440],['voice',880]])execFileSync('ffmpeg',['-v','error','-f','lavfi','-i',`sine=frequency=${hz}:duration=8:sample_rate=48000`,'-c:a','pcm_s16le','-y',join(directory,name+'.wav')]);
  const music={id:'music',kind:'audio',assetId:'song',track:2,start:1,duration:6,sourceStart:1,volume:1,audio:{...DEFAULT_AUDIO_SETTINGS,role:'music',fadeIn:1,fadeOut:1,ducking:{enabled:true,amount:.75,attack:.5,release:.5}}};
  const voice={id:'voice',kind:'audio',assetId:'spoken',track:1,start:3,duration:2,sourceStart:2,volume:.3,audio:{...DEFAULT_AUDIO_SETTINGS,role:'voice'}};
  const timeline={clips:[music,voice]},automation=audioVolumeEnvelope(timeline,music),lane=parseAutomation(automation).lanes[0];
  const escape=value=>String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  const html='<div data-composition-id="audio-regression" data-duration="8">'+timeline.clips.map(clip=>{const settings=audioSettings(clip);return `<audio id="${clip.id}" src="./${clip.id}.wav" data-start="${clip.start}" data-duration="${clip.duration}" data-end="${clip.start+clip.duration}" data-media-start="${clip.sourceStart}" data-volume="${clip.volume}" data-fade-in="${settings.fadeIn}" data-fade-out="${settings.fadeOut}" data-automation="${escape(audioVolumeEnvelope(timeline,clip))}"></audio>`}).join('')+'</div>';
  const parsed=parseAudioElements(html);assert.equal(parsed.length,2);assert.equal(parsed[0].automation,automation);assert.equal(parsed[0].fadeIn,1);assert.equal(parsed[0].mediaStart,1);
  const output=join(directory,'audio.m4a'),result=await processCompositionAudio(parsed,directory,join(directory,'work'),output,8,undefined,{audioGain:1,ffmpegProcessTimeout:30000});
  assert.equal(result.success,true,JSON.stringify(result));assert.equal(result.tracksProcessed,2);
  const raw=execFileSync('ffmpeg',['-v','error','-i',output,'-f','f32le','-ac','1','-ar','48000','-'],{maxBuffer:8*48000*4+100000});
  const samples=new Float32Array(raw.buffer,raw.byteOffset,Math.floor(raw.byteLength/4));
  function amplitude(time){let cosine=0,sine=0;const start=Math.round((time-.1)*48000),count=9600;for(let i=0;i<count;i++){const phase=2*Math.PI*440*(start+i)/48000;cosine+=samples[start+i]*Math.cos(phase);sine+=samples[start+i]*Math.sin(phase)}return Math.hypot(cosine,sine)*2/count}
  const baseline=amplitude(2.2);
  for(const time of [1.5,3.5,5.7,6.5]){
    const expected=sampleAutomationLane(lane,time-music.start)*fadeGain(time-music.start,music.duration,audioSettings(music));
    const ratio=amplitude(time)/baseline;assert.ok(Math.abs(ratio-expected)<.035,JSON.stringify({time,ratio,expected}));
  }
  assert.ok(samples.slice(0,24000).every(value=>Math.abs(value)<.0001),'Audio retains authored start silence');
  console.log('PASS: native HyperFrames audio parser + actual FFmpeg mixer, role-based music ducking .25 gain, exact native preview/reference envelope and edge fade ratios, source trims and delayed start retained; synthetic tones only.');
}finally{await rm(directory,{recursive:true,force:true})}
