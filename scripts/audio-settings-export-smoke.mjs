import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseAudioElements,processCompositionAudio} from '@hyperframes/engine';
import {parseAutomation,sampleAutomationLane} from '@hyperframes/core/audio-automation';
import {fadeGain} from '@hyperframes/core/audio-fade';

const directory=await mkdtemp(join(tmpdir(),'revline-audio-settings-'));
try{
  const helper=join(directory,'audio.mjs');
  await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:"export {audioSettings,audioVolumeEnvelope,DEFAULT_AUDIO_SETTINGS} from './lib/editor/audio-settings';export {generateComposition} from './lib/editor/composition';export {splitClip} from './lib/editor/operations';"},outfile:helper,bundle:true,platform:'node',format:'esm'});
  const {audioSettings,audioVolumeEnvelope,DEFAULT_AUDIO_SETTINGS,generateComposition,splitClip}=await import(pathToFileURL(helper).href);
  for(const [name,hz] of [['music',440],['voice',880]])execFileSync('ffmpeg',['-v','error','-f','lavfi','-i',`sine=frequency=${hz}:duration=8:sample_rate=48000`,'-c:a','pcm_s16le','-y',join(directory,name+'.wav')]);
  const fallback={clips:[{id:'music',kind:'audio',assetId:'song',track:2,start:1,duration:6,sourceStart:1,volume:1,audio:{...DEFAULT_AUDIO_SETTINGS,role:'music',fadeIn:1,fadeOut:1,ducking:{enabled:true,amount:.75,attack:.5,release:.5}}},{id:'voice',kind:'audio',assetId:'spoken',track:1,start:3,duration:2,sourceStart:2,volume:.3,audio:{...DEFAULT_AUDIO_SETTINGS,role:'voice'}}]};
  const timeline=process.env.REVLINE_AGENT_AUDIO_FIXTURE?JSON.parse(await readFile(process.env.REVLINE_AGENT_AUDIO_FIXTURE,'utf8')):fallback,music=timeline.clips.find(clip=>clip.id==='music'),automation=audioVolumeEnvelope(timeline,music),lane=parseAutomation(automation).lanes[0];
  const html=generateComposition({clips:timeline.clips,fps:30,aspectRatio:'landscape',tracks:{visual:0,overlay:0,audio:2,effects:0}},[{_id:'song',kind:'audio',fileName:'Music',url:'./music.wav'},{_id:'spoken',kind:'audio',fileName:'Voice',url:'./voice.wav'}]);
  const parsed=parseAudioElements(html);assert.equal(parsed.length,2);assert.equal(parsed[0].automation,automation);assert.equal(parsed[0].fadeIn,audioSettings(music).fadeIn);assert.equal(parsed[0].mediaStart,1);
  const output=join(directory,'audio.m4a'),result=await processCompositionAudio(parsed,directory,join(directory,'work'),output,8,undefined,{audioGain:1,ffmpegProcessTimeout:30000});
  assert.equal(result.success,true,JSON.stringify(result));assert.equal(result.tracksProcessed,2);
  const raw=execFileSync('ffmpeg',['-v','error','-i',output,'-f','f32le','-ac','1','-ar','48000','-'],{maxBuffer:8*48000*4+100000});
  const samples=new Float32Array(raw.buffer,raw.byteOffset,Math.floor(raw.byteLength/4));
  function amplitude(time){let cosine=0,sine=0;const start=Math.round((time-.1)*48000),count=9600;for(let i=0;i<count;i++){const phase=2*Math.PI*440*(start+i)/48000;cosine+=samples[start+i]*Math.cos(phase);sine+=samples[start+i]*Math.sin(phase)}return Math.hypot(cosine,sine)*2/count}
  const baseline=amplitude(2.2);
  for(const time of [1.5,3.5,5.7,6.5]){
    let expected=0;for(let i=0;i<9600;i++){const local=time-.1+i/48000-music.start;expected+=sampleAutomationLane(lane,local)/(music.volume??1)*fadeGain(local,music.duration,audioSettings(music))/9600}
    const ratio=amplitude(time)/baseline;assert.ok(Math.abs(ratio-expected)<.035,JSON.stringify({time,ratio,expected}));
  }
  const splitTimeline=splitClip({clips:timeline.clips,fps:30,aspectRatio:'landscape',tracks:{visual:0,overlay:0,audio:2,effects:0}},'music',5,'music-right');
  const splitHtml=generateComposition(splitTimeline,[{_id:'song',kind:'audio',fileName:'Music',url:'./music.wav'},{_id:'spoken',kind:'audio',fileName:'Voice',url:'./voice.wav'}]);
  const splitTracks=parseAudioElements(splitHtml);assert.equal(splitTracks.length,3);for(const track of splitTracks.filter(track=>track.src==='./music.wav')){assert.equal(track.fadeIn??0,0);assert.equal(track.fadeOut??0,0);}
  const splitOutput=join(directory,'split-audio.m4a');assert.equal((await processCompositionAudio(splitTracks,directory,join(directory,'split-work'),splitOutput,8,undefined,{audioGain:1,ffmpegProcessTimeout:30000})).success,true);
  const splitRaw=execFileSync('ffmpeg',['-v','error','-i',splitOutput,'-f','f32le','-ac','1','-ar','48000','-'],{maxBuffer:8*48000*4+100000}),splitSamples=new Float32Array(splitRaw.buffer,splitRaw.byteOffset,Math.floor(splitRaw.byteLength/4));
  const splitAmplitude=time=>{let cosine=0,sine=0;const start=Math.round((time-.1)*48000);for(let i=0;i<9600;i++){const phase=2*Math.PI*440*(start+i)/48000;cosine+=splitSamples[start+i]*Math.cos(phase);sine+=splitSamples[start+i]*Math.sin(phase)}return Math.hypot(cosine,sine)*2/9600};
  for(const time of [4.8,4.95,5,5.05,5.3,6.5])assert.ok(Math.abs(splitAmplitude(time)-amplitude(time))/baseline<.035,'Splitting fades restarts gain near '+time);
  console.log('PASS: actual FFmpeg split inside faded/ducked music keeps original gain before/at/aftercut and source phase; nativechildfades disabled, no newdip.');
  assert.ok(samples.slice(0,24000).every(value=>Math.abs(value)<.0001),'Audio retains authored start silence');
  console.log('PASS: real composition compiler + native HyperFrames audio parser + actual FFmpeg mixer, role-based music ducking at configured gain, exact native preview/reference envelope and edge fade ratios, source trims and delayed start retained; synthetic tones only.');
}finally{await rm(directory,{recursive:true,force:true})}
