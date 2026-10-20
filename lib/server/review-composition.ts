import { mkdir,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { MediaWorkItem,MediaTaskResult } from '../../convex/mediaTasks';
import type { MediaAsset } from '../editor/types';
import { dimensions } from '../editor/types';
import { checkPlanTiming } from '../ai/edit-plan';
import { compositionSampleTimes,pixelDifference } from '../ai/composition-review';
import { inspectCompositionFrames } from '../media-analysis/gemini';
import { AnalysisError } from '../media-analysis/errors';
import { prepareComposition,writeComposition,reviewWindowTimeline,linkCompositionResources } from './prepare-composition';
import { runCompositionCapture } from './render-worker';
export async function reviewComposition(snapshot:NonNullable<MediaWorkItem['review']>,directory:string,convexUrl:string,signal:AbortSignal,onProgress:(n:number)=>void):Promise<NonNullable<MediaTaskResult['review']>> {
  const key=process.env.GOOGLE_GENERATIVE_AI_API_KEY;if(!key)throw new AnalysisError('Gemini composition review is not configured.',503);
  const edited=reviewWindowTimeline(snapshot.timeline,snapshot.start,snapshot.end),reference=reviewWindowTimeline(snapshot.reference,snapshot.start,snapshot.end);
  const assets=snapshot.assets.filter(asset=>[...edited.clips,...reference.clips].some(clip=>clip.assetId===asset._id)) as (MediaAsset & {size:number})[];
  const {assetUrls,audioSourceOffsets}=await prepareComposition(directory,edited,assets,convexUrl,signal);
  for(const [name,timeline] of [['edited',edited],['reference',reference]] as const){const path=join(directory,name);await mkdir(path);await linkCompositionResources(directory,path,assetUrls);await writeComposition(path,timeline,assets,assetUrls,720,snapshot.timeline.fps as 24|30|60,'./',signal,audioSourceOffsets);}
  const times=compositionSampleTimes(snapshot.plans,snapshot.timeline.fps,snapshot.start,snapshot.end);
  onProgress(25);
  await runCompositionCapture(directory,{...dimensions(snapshot.timeline.aspectRatio,720),fps:snapshot.timeline.fps,times,start:snapshot.start,end:snapshot.end},signal);
  onProgress(65);
  const safe=JSON.parse(await readFile(join(directory,'text-safe.json'),'utf8')) as {clipId:string;safe:boolean}[][];
  const pairs=await Promise.all(times.map(async(time,index)=>{
    const [actual,baseline]=await Promise.all(['edited','reference'].map(name=>readFile(join(directory,name,`sample-${index}.png`))));
    const [a,b]=await Promise.all([actual,baseline].map(buffer=>sharp(buffer).resize(160,160,{fit:'fill'}).removeAlpha().raw().toBuffer()));
    const [edited,reference]=await Promise.all([actual,baseline].map(buffer=>sharp(buffer).resize(640,640,{fit:'inside'}).jpeg({quality:75}).toBuffer().then(buffer=>buffer.toString('base64'))));
    return {time,edited,reference,difference:pixelDifference(a,b)};
  }));
  if(pairs.reduce((sum,pair)=>sum+pair.edited.length+pair.reference.length,0)>8*1024*1024)throw new AnalysisError('Rendered review images exceed the bounded request size.',400);
  const checks=snapshot.plans.map(plan=>{
    const peak=plan.peak??plan.anchor.time,index=pairs.reduce((best,pair,i)=>Math.abs(pair.time-peak)<Math.abs(pairs[best].time-peak)?i:best,0),change=pairs[index].difference;
    const textBounds=safe.flat().filter(item=>item.clipId===(plan.outputClipId??plan.targetClipId));
    const inside=pairs.filter(pair=>pair.time>=plan.start&&pair.time<plan.start+plan.duration),strongest=inside.reduce((best,pair)=>!best||pair.difference>best.difference?pair:best,undefined as typeof pairs[number]|undefined);
    const returned=plan.checks?.returnBy===undefined?undefined:pairs.find(pair=>pair.time>=plan.checks!.returnBy!-1/snapshot.timeline.fps);
    return {sampledPeakTime:strongest?.time,returnPass:returned?returned.difference<=.02:null,planId:plan.id,timingPass:checkPlanTiming(plan,snapshot.timeline).pass,peakPixelChange:change,pixelPass:plan.checks?.minPixelChange===undefined&&plan.checks?.maxPixelChange===undefined?null:change>=(plan.checks?.minPixelChange??0)&&change<=(plan.checks?.maxPixelChange??1),textSafe:plan.checks?.textSafe&&textBounds.length?textBounds.every(item=>item.safe):null};
  });
  const observed=await inspectCompositionFrames(pairs,snapshot.plans,key,signal);onProgress(95);
  return {revision:snapshot.revision,sampleTimes:times,checks,...observed,uncertainty:`${observed.uncertainty} Sparse visual samples; timing checks compare clip ranges with the plan. Pixel change measures edited/reference difference, not a measured zoom scale or an exact impact. Text safety measures sampled bounds, not contrast. No audio judgement.`.slice(0,2000)};
}
