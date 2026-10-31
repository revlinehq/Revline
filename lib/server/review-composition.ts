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
import { measurePacing } from '../media-analysis/pacing';
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
  if(snapshot.pacing){
    // One capture session over the whole range at the sampling rate, read back as small grayscale frames.
    const {fps}=snapshot.pacing,start=Math.round(Math.min(snapshot.pacing.start,last)*timeline.fps)/timeline.fps,end=Math.min(snapshot.pacing.end,last);
    const times=Array.from({length:Math.floor((end-start)*fps+1e-6)+1},(_,index)=>Math.round((start+index/fps)*timeline.fps)/timeline.fps);
    if(times.length<3)throw new AnalysisError('Check pacing over at least 0.3 s.',400);
    const width=320,size=dimensions(timeline.aspectRatio,720),height=Math.max(2,Math.round(width*size.height/size.width));
    await runCompositionCapture(directory,{...size,fps:timeline.fps,times,start:times[0],end:times[times.length-1]+frame,variants:['edited'],pacing:{width}},signal);
    onProgress(85);
    const bytes=await readFile(join(directory,'pacing.bin')),frames=times.map((_,index)=>new Uint8Array(bytes.buffer,bytes.byteOffset+index*width*height,width*height));
    return {frames:[],pacing:measurePacing(frames,width,height,times[0],fps)};
  }
  const frames:NonNullable<MediaTaskResult['snapshot']>['frames']=[];
  const at=times.map(requested=>Math.round(Math.min(Math.max(0,requested),last)*timeline.fps)/timeline.fps);
  if(!timeline.clips.some(clip=>clip.kind==='video')){
    // Nothing to decode (scenes, text, images): the times within each 3 s span (the capture's limit) share one capture
    // session, instead of a browser start per frame.
    const order=at.map((time,index)=>({time,index})).sort((a,b)=>a.time-b.time),images=new Array<string>(at.length);
    for(let first=0;first<order.length;){
      let next=first;while(next+1<order.length&&order[next+1].time+frame-order[first].time<=3)next++;
      const group=order.slice(first,next+1);
      await runCompositionCapture(directory,{...dimensions(timeline.aspectRatio,720),fps:timeline.fps,times:group.map(item=>item.time),start:group[0].time,end:group[group.length-1].time+frame,variants:['edited']},signal);
      for(const [sample,item] of group.entries())images[item.index]=(await readFile(join(path,`sample-${sample}.png`))).toString('base64');
      first=next+1;onProgress(20+Math.round(75*first/order.length));
    }
    for(const [index,time] of at.entries())frames.push({time,image:images[index]});
  }
  // With footage, one frame-sized window per time keeps decoding bounded however far apart the times are.
  else for(const [index,time] of at.entries()){
    await runCompositionCapture(directory,{...dimensions(timeline.aspectRatio,720),fps:timeline.fps,times:[time],start:time,end:time+frame,variants:['edited']},signal);
    frames.push({time,image:(await readFile(join(path,'sample-0.png'))).toString('base64')});
    onProgress(20+Math.round(75*(index+1)/times.length));
  }
  if(snapshot.card)return {frames:[{time:frames[0].time,image:(await shareCard(Buffer.from(frames[0].image,'base64'),snapshot.card.title)).toString('base64')}]};
  // Results travel in one Convex document (1 MiB); shrink until every frame fits.
  const pngs=frames.map(frame=>Buffer.from(frame.image,'base64'));
  for(const [size,quality] of [[768,70],[640,60],[512,50],[384,45]] as const){
    const images=await Promise.all(pngs.map(png=>sharp(png).resize(size,size,{fit:'inside'}).jpeg({quality}).toBuffer().then(buffer=>buffer.toString('base64'))));
    if(images.reduce((sum,image)=>sum+image.length,0)<=700_000)return {frames:frames.map((frame,index)=>({time:frame.time,image:images[index]}))};
  }
  throw new AnalysisError('Rendered frames are too detailed to return. Ask for fewer times.',400);
}

const escapeXml=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
/** A link preview card, 1200x630: the frame full-bleed, a play button, and a strip with the timeline name and the Revline mark. */
async function shareCard(png:Buffer,title:string){
  const W=1200,H=630,STRIP=96,name=escapeXml(title.length>48?`${title.slice(0,47)}…`:title);
  const mark='<path d="M80.29961 2.30981l-64.85001 27.64999c-19.025 8.7-20.025 23.60001-5.5 26.475 31.85001 6.32501 51.425 10.5 61.97501 14.6 9.375 3.675 15.27499 10.30001 17.24998 17.00001l-3.29999-17.22501c-0.60001-3.49999-3.42501-8.12499-11.89998-11.27499l-20.82501-7.725c-8.1-3.75-5.05-10.875 0.15-12.675l15.45-5.475c19.425-7.175 18.275-35.94999 10.6-31.35z" transform="scale(.32)"/>';
  const overlay=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<rect x="0" y="${H-STRIP}" width="${W}" height="${STRIP}" fill="#0b0c0e" fill-opacity="0.82"/>
<circle cx="${W/2}" cy="${(H-STRIP)/2}" r="54" fill="#ffffff" fill-opacity="0.92"/>
<path d="M${W/2-16} ${(H-STRIP)/2-24} L${W/2+26} ${(H-STRIP)/2} L${W/2-16} ${(H-STRIP)/2+24} Z" fill="#0b0c0e"/>
<text x="40" y="${H-STRIP/2+12}" font-family="Liberation Sans, Arial, sans-serif" font-size="34" font-weight="700" fill="#f4f4f0">${name}</text>
<g transform="translate(${W-188} ${H-STRIP/2-16})" fill="#f4f4f0">${mark}<text x="44" y="26" font-family="Liberation Sans, Arial, sans-serif" font-size="30" font-weight="700" letter-spacing="-1">revline</text></g>
</svg>`;
  return sharp(png).resize(W,H,{fit:'cover'}).composite([{input:Buffer.from(overlay),top:0,left:0}]).jpeg({quality:84}).toBuffer();
}
