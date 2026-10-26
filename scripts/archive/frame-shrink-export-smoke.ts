import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {copyFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
import {addEffectClip,patchClip} from '../../lib/editor/operations';
import {configureTimedEffectPatch} from '../../lib/editor/clip-effects';
import {generateComposition} from '../../lib/editor/composition';
import {runRenderWorker} from '../../lib/server/render-worker';
import type {Timeline} from '../../lib/editor/types';

const require=createRequire(import.meta.url),sharp=require('sharp');
async function main(){
 const directory=await mkdtemp(join(tmpdir(),'revline-frame-shrink-render-'));
 try{
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#00ff00"/><rect x="16" y="81" width="32" height="18" fill="#ff0000"/></svg>';
  await sharp(Buffer.from(svg)).resize(1280,720).png().toFile(join(directory,'scene.png'));
  await copyFile('public/vendor/gsap.min.js',join(directory,'gsap.min.js'));await copyFile('public/fonts/space-grotesk-latin.woff2',join(directory,'space-grotesk-latin.woff2'));
  const runtime=await build({entryPoints:['lib/editor/visual-effects-runtime.ts'],bundle:true,platform:'browser',format:'iife',globalName:'__revlineVisualEffects',write:false});await writeFile(join(directory,'visual-effects.js'),runtime.outputFiles[0].text);
  const base:Timeline={fps:24,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:0,effects:0},clips:[{id:'base',kind:'image',assetId:'scene',track:1,start:0,duration:1.5,sourceStart:0}]};
  let timeline=addEffectClip(base,'shrink','frame-shrink',.25,{duration:1});timeline=patchClip(timeline,'shrink',configureTimedEffectPatch(timeline.clips.at(-1)!,{frameShrink:{size:.2,speed:2}}));
  const html=generateComposition(timeline,[{_id:'scene',fileName:'Owned scene.png',kind:'image',width:1280,height:720,url:'./scene.png'}],{resolution:720,fps:24,gsapUrl:'./gsap.min.js',visualEffectsUrl:'./visual-effects.js',fontUrl:'./space-grotesk-latin.woff2'});await writeFile(join(directory,'index.html'),html);
  const output=join(directory,'output.mp4'),result=await runRenderWorker(directory,output,{fps:24,quality:'draft'},()=>{},AbortSignal.timeout(90000));assert.equal(result.warnings,0);
  const meta=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,width,height,r_frame_rate,nb_frames:format=duration','-of','json',output],{encoding:'utf8'}));assert.equal(meta.streams[0].width,1280);assert.equal(meta.streams[0].height,720);assert.equal(meta.streams[0].nb_frames,'36');assert.equal(meta.streams[0].r_frame_rate,'24/1');assert.equal(Number(meta.format.duration),1.5);
  const pixel=(time:number,x:number,y:number)=>[...execFileSync('ffmpeg',['-v','error','-ss',String(time),'-i',output,'-vf',`crop=2:2:${x}:${y},scale=1:1`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'])];
  const near=(time:number,x:number,y:number,target:number[],label:string)=>{const actual=pixel(time,x,y);assert.ok(actual.length===3&&actual.every((v,i)=>Math.abs(v-target[i])<12),label+':'+actual)};
  for(const time of [.125,1.375]){near(time,64,36,[0,255,0],'Original full frame outside FX');near(time,128,360,[255,0,0],'Original marker position outside FX')}
  for(const [x,y] of [[64,360],[1216,360],[640,36],[640,684]])near(.75,x,y,[0,0,0],'All four sides reveal black composition background');
  near(.75,640,360,[0,255,0],'Shrunk footage retains center');near(.75,332,360,[255,0,0],'Decoded source marker moves toward center instead of being masked');
  await writeFile('/tmp/revline-frame-shrink-export-proof.json',JSON.stringify({preset:'frame-shrink',size:.2,speed:2,width:1280,height:720,fps:24,frames:36,duration:1.5,warnings:0,sourceActuallyMoves:true,fourBlackSides:true,neutralOutsideRange:true}));
  console.log('PASS: actual1.5s/36-frame720pH264 export shrinks original footage, moves its marker inward, exposes black on all four sides and restores the exact framing afterward.');
 }finally{await rm(directory,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error);process.exitCode=1});
