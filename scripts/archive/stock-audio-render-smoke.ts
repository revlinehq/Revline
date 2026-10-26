import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {copyFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateComposition} from '../../lib/editor/composition';
import {STOCK_AUDIO_CATALOG,stockAudio,stockAudioAsset} from '../../lib/editor/stock-audio';
import {runRenderWorker} from '../../lib/server/render-worker';
import type {Timeline} from '../../lib/editor/types';

function samples(file:string){const bytes=execFileSync('ffmpeg',['-v','error','-i',file,'-af','pan=mono|c0=0.5*c0+0.5*c1','-ar','48000','-f','f32le','-'],{maxBuffer:16*1024*1024});return new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);}
function rms(data:Float32Array,start:number,end:number){let sum=0;const first=Math.round(start*48000),last=Math.min(data.length,Math.round(end*48000));for(let i=first;i<last;i++)sum+=data[i]*data[i];return Math.sqrt(sum/(last-first));}
async function main(){
 for(const sound of STOCK_AUDIO_CATALOG.filter(item=>item.pack==='Revline originals')){
  const data=samples(sound.file),peak=data.reduce((maximum,value)=>Math.max(maximum,Math.abs(value)),0),level=rms(data,0,sound.duration);
  assert.ok(peak<.86&&level>.07&&level<.16,sound.id+' is audible and has safe headroom');
  assert.ok(rms(data,0,.005)<.006&&rms(data,sound.duration-.005,sound.duration)<level*.4&&Math.abs(data.at(-1)!)<.003,sound.id+' has click-free fades');
  if(sound.category==='Risers')assert.ok(rms(data,sound.duration*.72,sound.duration*.92)>rms(data,.05,sound.duration*.25)*2,sound.id+' builds in energy');
 }
 const directory=await mkdtemp(join(tmpdir(),'revline-stock-audio-render-'));
 try{
  const ids=['riser-short','whoosh-light'];for(const id of ids)await copyFile(stockAudio(id)!.file,join(directory,id+'.ogg'));
  await writeFile(join(directory,'background.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#211a32"/><text x="640" y="350" fill="#b89cff" font-family="sans-serif" font-size="58" text-anchor="middle">Audio FX</text></svg>');
  for(const name of ['visual-effects.js','gsap.min.js'])await copyFile('public/vendor/'+name,join(directory,name));await copyFile('public/fonts/space-grotesk-latin.woff2',join(directory,'font.woff2'));
  const timeline:Timeline={fps:24,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:1,effects:0},clips:[{id:'bg',kind:'image',assetId:'bg',start:0,duration:4.5,sourceStart:0,track:1},...ids.map((id,index)=>({id,kind:'audio' as const,assetId:'stock-audio-'+id,start:index?3:.5,duration:stockAudio(id)!.duration,sourceStart:0,track:1,volume:.7}))]};
  const assets=[{_id:'bg',kind:'image' as const,fileName:'background.svg',url:'./background.svg',width:1280,height:720},...ids.map(id=>({...stockAudioAsset(id),url:'./'+id+'.ogg'}))];
  await writeFile(join(directory,'index.html'),generateComposition(timeline,assets,{resolution:720,visualEffectsUrl:'./visual-effects.js',gsapUrl:'./gsap.min.js',fontUrl:'./font.woff2'}));
  const output='/tmp/revline-audio-fx.mp4',result=await runRenderWorker(directory,output,{fps:24,quality:'standard'},()=>{},AbortSignal.timeout(120000));assert.equal(result.warnings,0);
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output],{encoding:'utf8'}));assert.ok(probe.streams.some((stream:{codec_name:string})=>stream.codec_name==='h264'));assert.ok(probe.streams.some((stream:{codec_name:string})=>stream.codec_name==='aac'));assert.ok(Math.abs(Number(probe.format.duration)-4.5)<.15);
  const data=samples(output);assert.ok(rms(data,.1,.35)<.0001,'Leading silence retained');assert.ok(rms(data,1.7,2.2)>.025,'Actual riser is mixed at its timeline position');assert.ok(rms(data,2.7,2.85)<.0001,'Gap between sounds retained');assert.ok(rms(data,3.12,3.32)>.025,'Actual whoosh is mixed at its timeline position');assert.ok(rms(data,3.9,4.25)<.0001,'Tail silence retained');
  console.log('PASS:8 original sounds decode with safe peak/RMS, click-free edges and increasing riser energy; real H264/AAC MP4 mixes riser/whoosh at authored positions with silent gaps. '+output);
 }finally{await rm(directory,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
