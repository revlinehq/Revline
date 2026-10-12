import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateComposition } from '../lib/editor/composition';
import type { Clip, Timeline } from '../lib/editor/types';
import { runRenderWorker } from '../lib/server/render-worker';

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'revline-visual-test-'));
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=640x1080', '-f', 'lavfi', '-i', 'color=c=green:s=640x1080', '-f', 'lavfi', '-i', 'color=c=blue:s=640x1080', '-filter_complex', '[0:v][1:v][2:v]hstack=inputs=3[v]', '-map', '[v]', '-frames:v', '1', '-y', join(directory,'bars.png')]);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=720x720', '-frames:v', '1', '-y', join(directory,'red.png')]);
    await copyFile('public/vendor/gsap.min.js',join(directory,'gsap.min.js'));
    await copyFile('public/fonts/space-grotesk-latin.woff2',join(directory,'font.woff2'));
    const crop = {left:2/3,top:0,right:0,bottom:0};
    const upper:Clip = {id:'upper',kind:'image',assetId:'bars',track:2,start:0,duration:1,sourceStart:0,crop,fit:'contain',transform:{x:.7,y:.3,scale:.4,rotation:0,opacity:1}};
    // Higher layer deliberately comes first, testing z order independently of array order.
    const timeline:Timeline = {fps:24,aspectRatio:'square',clips:[upper,{...upper,id:'rotated',start:1,transform:{...upper.transform!,rotation:90,opacity:.5}},{...upper,id:'cover',start:2,fit:'cover',transform:{x:.5,y:.5,scale:1,rotation:0,opacity:1}},{id:'lower',kind:'image',assetId:'red',track:1,start:0,duration:3,sourceStart:0}]};
    await writeFile(join(directory,'index.html'),generateComposition(timeline,[{_id:'bars',kind:'image',fileName:'bars.png',width:1920,height:1080,url:'./bars.png'},{_id:'red',kind:'image',fileName:'red.png',width:720,height:720,url:'./red.png'}],{resolution:720,gsapUrl:'./gsap.min.js',fontUrl:'./font.woff2'}));
    const output=join(directory,'visual.mp4');
    const result=await runRenderWorker(directory,output,{fps:24,quality:'draft'},()=>{},AbortSignal.timeout(60000));
    assert.equal(result.warnings,0);
    function pixel(time:number,x:number,y:number){return [...execFileSync('ffmpeg',['-v','error','-ss',String(time),'-i',output,'-vf',`crop=2:2:${x}:${y},scale=1:1`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'])];}
    function blue(time:number,x:number,y:number){const p=pixel(time,x,y);assert.ok(p[2]>180&&p[0]<40&&p[1]<40,`Expected blue ${time}s ${x},${y}; got ${p}`);}
    function red(time:number,x:number,y:number){const p=pixel(time,x,y);assert.ok(p[0]>180&&p[1]<40&&p[2]<40,`Expected red ${time}s ${x},${y}; got ${p}`);}
    blue(0,504,216);red(.5,380,216);red(.5,504,50);
    const purple=pixel(1.5,380,216);assert.ok(purple[0]>100&&purple[0]<155&&purple[2]>100&&purple[2]<155&&purple[1]<40,`Rotation/opacity expected purple at 380,216; got ${purple}`);
    red(1.5,504,90);
    blue(2.5,10,10);blue(2.5,710,710);
    console.log('Visual render passed: higher V2 layer wins, true blue source crop, contain mask reveals V1 letterbox, position/scale, 90-degree rotation, real opacity blend, cover fill, exact-zero frame, zero warnings.');
  } finally {await rm(directory,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
