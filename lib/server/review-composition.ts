import { mkdir,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { MediaWorkItem,MediaTaskResult } from '../../convex/mediaTasks';
import type { MediaAsset } from '../editor/types';
import { dimensions, timelineDuration } from '../editor/types';
import { checkPlanTiming } from '../ai/edit-plan';
import { compositionSampleTimes,pixelDifference } from '../ai/composition-review';
import { inspectCompositionFrames } from '../media-analysis/gemini';
import { AnalysisError } from '../media-analysis/errors';
import { sceneMediaAssetIds } from '../editor/scene-layers';
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

/** Frames of the saved timeline exactly as export draws them, for an MCP client to look at. */
export async function captureTimelineFrames(snapshot:NonNullable<MediaWorkItem['snapshot']>,directory:string,convexUrl:string,signal:AbortSignal,onProgress:(n:number)=>void):Promise<NonNullable<MediaTaskResult['snapshot']>> {
  const {timeline,times}=snapshot,frame=1/timeline.fps,last=Math.max(0,timelineDuration(timeline)-frame);
  const sceneMedia=new Set(sceneMediaAssetIds(timeline));
  const assets=snapshot.assets.filter(asset=>sceneMedia.has(asset._id)||timeline.clips.some(clip=>clip.assetId===asset._id)) as (MediaAsset & {size:number})[];
  const {assetUrls,audioSourceOffsets}=await prepareComposition(directory,timeline,assets,convexUrl,signal);
  const path=join(directory,'edited');await mkdir(path);await linkCompositionResources(directory,path,assetUrls);
  await writeComposition(path,timeline,assets,assetUrls,720,timeline.fps as 24|30|60,'./',signal,audioSourceOffsets);
  onProgress(20);
  const frames:NonNullable<MediaTaskResult['snapshot']>['frames']=[];
  // One frame-sized window per time keeps decoding bounded however far apart the times are.
  for(const [index,requested] of times.entries()){
    const time=Math.round(Math.min(Math.max(0,requested),last)*timeline.fps)/timeline.fps;
    await runCompositionCapture(directory,{...dimensions(timeline.aspectRatio,720),fps:timeline.fps,times:[time],start:time,end:time+frame,variants:['edited']},signal);
    frames.push({time,image:(await readFile(join(path,'sample-0.png'))).toString('base64')});
    onProgress(20+Math.round(75*(index+1)/times.length));
  }
  // Results travel in one Convex document (1 MiB); shrink until every frame fits.
  const pngs=frames.map(frame=>Buffer.from(frame.image,'base64'));
  for(const [size,quality] of [[768,70],[640,60],[512,50],[384,45]] as const){
    const images=await Promise.all(pngs.map(png=>sharp(png).resize(size,size,{fit:'inside'}).jpeg({quality}).toBuffer().then(buffer=>buffer.toString('base64'))));
    if(images.reduce((sum,image)=>sum+image.length,0)<=700_000)return {frames:frames.map((frame,index)=>({time:frame.time,image:images[index]}))};
  }
  throw new AnalysisError('Rendered frames are too detailed to return. Ask for fewer times.',400);
}
