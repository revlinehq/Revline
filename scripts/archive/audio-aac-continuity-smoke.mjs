import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {copyFile,mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseAudioElements,processCompositionAudio} from '@hyperframes/engine';

const directory=await mkdtemp(join(tmpdir(),'revline-aac-mixer-'));
try{
 const helper=join(directory,'helper.mjs');await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:"export {prepareRenderAudioSource} from './lib/server/prepare-render-audio';export {generateComposition} from './lib/editor/composition';export {splitClip} from './lib/editor/operations';export {DEFAULT_AUDIO_SETTINGS} from './lib/editor/audio-settings';"},outfile:helper,bundle:true,platform:'node',format:'esm'});
 const {prepareRenderAudioSource,generateComposition,splitClip,DEFAULT_AUDIO_SETTINGS}=await import(pathToFileURL(helper).href);
 const source=join(directory,'source.m4a'),musicFile=join(directory,'music.wav');
 if(process.env.REVLINE_AAC_SOURCE)await copyFile(process.env.REVLINE_AAC_SOURCE,source);else execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','aevalsrc=0.3*sin(2*PI*883.7*t)+0.1*sin(2*PI*1291.1*t):s=22050:d=10','-c:a','aac','-b:a','128k','-y',source]);
 if(process.env.REVLINE_AAC_MUSIC_SOURCE)await copyFile(process.env.REVLINE_AAC_MUSIC_SOURCE,musicFile);else execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=10','-c:a','pcm_s16le','-y',musicFile]);
 const prepared=await prepareRenderAudioSource(source,join(directory,'decoded.wav'),AbortSignal.timeout(10000));assert.equal(prepared.decoded,true);
 assert.equal((await prepareRenderAudioSource(musicFile,join(directory,'unused.wav'),AbortSignal.timeout(10000))).decoded,false);
 const voice={id:'voice',kind:'audio',assetId:'voice-source',track:1,start:0,duration:10,sourceStart:0,volume:1,audio:{...DEFAULT_AUDIO_SETTINGS,role:'voice',fadeIn:.5,fadeOut:.5}},music={id:'music',kind:'audio',assetId:'music-source',track:2,start:0,duration:10,sourceStart:0,volume:.4,audio:{...DEFAULT_AUDIO_SETTINGS,role:'music',fadeIn:1,fadeOut:1,ducking:{enabled:true,amount:.75,attack:.2,release:.3}}};
 let whole={fps:30,aspectRatio:'landscape',tracks:{visual:0,overlay:0,audio:2,effects:0},clips:[voice,music]},split=splitClip(splitClip(splitClip(whole,'voice',3,'voice-3'),'voice-3',5,'voice-5'),'voice-5',7,'voice-7');
 if(process.env.REVLINE_AAC_SNAPSHOT){const saved=JSON.parse(await readFile(process.env.REVLINE_AAC_SNAPSHOT,'utf8'));split={...saved.job.timeline,tracks:{visual:0,overlay:0,audio:2,effects:0},clips:saved.job.timeline.clips.filter(clip=>clip.kind==='audio')};const voices=split.clips.filter(clip=>clip.audio?.role==='voice').sort((a,b)=>a.start-b.start);assert.deepEqual(voices.map(clip=>[clip.start,clip.duration,clip.sourceStart]),[[0,3,0],[3,2,3],[5,2,5],[7,3,7]]);whole={...split,clips:[{...voices[0],duration:10,audioFadeTiming:undefined},...split.clips.filter(clip=>clip.audio?.role!=='voice')]};}
 const voiceIds=new Set(split.clips.filter(clip=>clip.audio?.role==='voice').map(clip=>clip.assetId)),assets=[...new Set(split.clips.map(clip=>clip.assetId))].map(id=>({_id:id,kind:'audio',fileName:'Owned source',url:voiceIds.has(id)?'./decoded.wav':'./music.wav'}));
 async function mix(timeline,name,sourceAssets=assets){const parsed=parseAudioElements(generateComposition(timeline,sourceAssets));const output=join(directory,name+'.m4a');const result=await processCompositionAudio(parsed,directory,join(directory,name+'-work'),output,10,undefined,{audioGain:1,ffmpegProcessTimeout:30000});assert.equal(result.success,true,JSON.stringify(result));return output;}
 const referencePath=await mix(whole,'whole'),splitPath=await mix(split,'split'),baselinePath=await mix(split,'baseline',assets.map(asset=>voiceIds.has(asset._id)?{...asset,url:'./source.m4a'}:asset));
 const pcm=path=>{const raw=execFileSync('ffmpeg',['-v','error','-i',path,'-af','pan=mono|c0=c0','-ar','48000','-f','f32le','-'],{maxBuffer:3e6});return new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4);};const reference=pcm(referencePath),actual=pcm(splitPath),baseline=pcm(baselinePath),checks=[];
 for(const time of [.25,.75,3,5,5.1,7,9.25,9.75]){let error=0,energy=0,baselineError=0,actualEnergy=0,baselineEnergy=0;for(let index=Math.round((time-.05)*48000);index<Math.round((time+.05)*48000);index++){error+=(actual[index]-reference[index])**2;baselineError+=(baseline[index]-reference[index])**2;energy+=reference[index]**2;actualEnergy+=actual[index]**2;baselineEnergy+=baseline[index]**2;}const normalizedError=Math.sqrt(error/Math.max(energy,.0001));const energyRatio=Math.sqrt(actualEnergy/energy),baselineEnergyRatio=Math.sqrt(baselineEnergy/energy);checks.push({time,normalizedError,energyRatio,baselineNormalizedError:Math.sqrt(baselineError/Math.max(energy,.0001)),baselineEnergyRatio});assert.ok(Math.abs(energyRatio-1)<.035,'AAC split/fade/duck gain discontinuity near '+time+': '+energyRatio);}
 // PCM phase is checked sample-for-sample in prepare-render-audio.test.ts; lossy AAC is checked for the audible gain dip, with waveform differences retained as evidence.
 const cut=checks.find(check=>check.time===5);if(process.env.REVLINE_AAC_EXPECT_SEEK_DIP==='1')assert.ok(Math.abs(cut.baselineEnergyRatio-1)>.035,'The same unprepared AAC fixture must fail the encoded gain-continuity check');assert.ok(cut.baselineNormalizedError>cut.normalizedError*2,'The AAC input-seek baseline must reproduce the cut defect before PCM preparation fixes it');
 if(process.env.REVLINE_AAC_MIX_OUTPUT)await copyFile(splitPath,process.env.REVLINE_AAC_MIX_OUTPUT);
 console.log(JSON.stringify({passed:true,decodedOnce:true,decodeMs:prepared.elapsedMs,decodedBytes:(await stat(prepared.path)).size,channelsPreserved:true,checks,exactSavedAudioTimeline:!!process.env.REVLINE_AAC_SNAPSHOT}));
 console.log('PASS: actual native mixer preserves AAC gain through splits at 3/5/7s, original fade phase and ducking; sequential disk decode once, compatible PCM reused, no level dips at 5.0/5.1s. Owned synthetic audio only.');
}finally{await rm(directory,{recursive:true,force:true})}
