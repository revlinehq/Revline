// Owned synthetic media only. No provider requests and no user browser access.
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { addEffectClip } from '../lib/editor/operations';
import { writeComposition,linkCompositionResources } from '../lib/server/prepare-composition';
import { runCompositionCapture } from '../lib/server/render-worker';
import { effectDisabledReference,type EffectPlan } from '../lib/ai/edit-plan';
import { compositionSampleTimes,pixelDifference } from '../lib/ai/composition-review';
import { TEXT_FONTS } from '../lib/editor/text-fonts';
import { copyFile } from 'node:fs/promises';
import type { Timeline,MediaAsset } from '../lib/editor/types';
async function main(){
const dir=await mkdtemp(join(tmpdir(),'revline-review-smoke-'));
try{
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=3','-c:v','libx264','-pix_fmt','yuv420p','-y',join(dir,'source.mp4')]);
  const timeline:Timeline={fps:30,aspectRatio:'landscape',clips:[{id:'source',assetId:'asset',kind:'video',start:0,duration:3,sourceStart:0,volume:0},{id:'unsafe-title',kind:'graphic',text:'Outside safe area',fontSize:45,x:.99,y:.5,start:0,duration:3,sourceStart:0,animation:'none'}]};
  const edited=addEffectClip(timeline,'fx','punch',1,{duration:.4});
  const plan:EffectPlan={id:'impact',kind:'timed',effect:'punch',outputClipId:'fx',start:1,duration:.4,peak:1.16,purpose:'Synthetic punch check',strength:'Fixed preset',expectation:'Zoom changes the pixels then returns',anchor:{kind:'requested-time',time:1.16,description:'Synthetic timing'}};
  const reference=effectDisabledReference(edited,[plan],[]),assets:MediaAsset[]=[{_id:'asset',kind:'video',fileName:'source.mp4',url:'./source.mp4',width:320,height:180,duration:3}];
  for(const name of ['gsap.min.js','visual-effects.js','remotion-runtime.js'])await copyFile(join(process.cwd(),'public/vendor',name),join(dir,name));
  for(const font of TEXT_FONTS)await copyFile(join(process.cwd(),'public/fonts',font.fileName),join(dir,font.fileName));
  for(const [name,timeline] of [['edited',edited],['reference',reference]] as const){const path=join(dir,name);await mkdir(path);await linkCompositionResources(dir,path,{asset:'./source.mp4'});await writeComposition(path,timeline,assets,{asset:'./source.mp4'},720,30);}
  const times=compositionSampleTimes([plan],30,.966666666666,1.466666666667);
  await runCompositionCapture(dir,{width:1280,height:720,fps:30,times,start:.96666666666,end:1.46666666667},AbortSignal.timeout(120000));
  const changes=[];
  for(const [index,time] of times.entries()){
    const [a,b]=await Promise.all(['edited','reference'].map(name=>sharp(join(dir,name,`sample-${index}.png`)).resize(160,90).removeAlpha().raw().toBuffer()));
    const change=pixelDifference(a,b);changes.push({time,change});
    if(time<1||time>=1.4){if(change>.002)throw new Error('Effect does not return to its reference outside the planned window.');}
  }
  if(!changes.some(sample=>sample.time>1&&sample.time<1.4&&sample.change>.01))throw new Error('The captured punch is invisible.');
  const bounds=JSON.parse(await readFile(join(dir,'text-safe.json'),'utf8'));if(!bounds.flat().some((item:{clipId:string;safe:boolean})=>item.clipId==='unsafe-title'&&!item.safe))throw new Error('Text safety failed to detect an out-of-bounds title.');
  const stats=await sharp(join(dir,'edited','sample-0.png')).stats();if(stats.channels.every(c=>c.mean<1))throw new Error('Source frames are black.');
  await writeFile('/tmp/revline-composition-review-proof.json',JSON.stringify({engine:'HyperFrames export capture + FFmpeg frame injection',paidModelCalls:0,changes},null,2));
  console.log(JSON.stringify({passed:true,samples:times.length,paidModelCalls:0,changes}));
}finally{await rm(dir,{recursive:true,force:true});}

}
void main();
