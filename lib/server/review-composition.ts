import type { FrameCache } from './frame-cache';
import { mkdir,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { MediaWorkItem,MediaTaskResult } from '../../convex/lib/media_task_contract';
import type { MediaAsset } from '../editor/types';
import { dimensions, timelineDuration } from '../editor/types';
import { checkPlanTiming } from '../ai/edit-plan';
import { changedShare,compositionSampleTimes,pixelDifference } from '../ai/composition-review';
import { inspectCompositionFrames } from '../media-analysis/gemini';
import { AnalysisError } from '../media-analysis/errors';
import { sceneMediaAssetIds } from '../editor/scene-layers';
import { prepareComposition,writeComposition,reviewWindowTimeline,linkCompositionResources } from './prepare-composition';
import { runCompositionCapture } from './render-worker';
import { measurePacing } from '../media-analysis/pacing';
import { visualHits } from '../media-analysis/sound';
import { mapMotion, motionWindow } from '../inspo-motion/motion-map';
import { measureTimelineSound } from './sound-check';
import { cropBounds } from '../ai/reference-comparison';
export async function reviewComposition(snapshot:NonNullable<MediaWorkItem['review']>,directory:string,convexUrl:string,signal:AbortSignal,onProgress:(n:number)=>void):Promise<NonNullable<MediaTaskResult['review']>> {
  const key=process.env.GOOGLE_GENERATIVE_AI_API_KEY;if(!key)throw new AnalysisError('Gemini composition review is not configured.',503);
  const edited=reviewWindowTimeline(snapshot.timeline,snapshot.start,snapshot.end),reference=reviewWindowTimeline(snapshot.reference,snapshot.start,snapshot.end);
  const assets=snapshot.assets.filter(asset=>[...edited.clips,...reference.clips].some(clip=>clip.assetId===asset._id||clip.normalizedAudio?.assetId===asset._id)) as (MediaAsset & {size:number})[];
  const {assetUrls,audioSourceOffsets}=await prepareComposition(directory,edited,assets,convexUrl,signal,[reference]);
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
export async function captureTimelineFrames(snapshot:NonNullable<MediaWorkItem['snapshot']>,directory:string,convexUrl:string,signal:AbortSignal,onProgress:(n:number)=>void,cache?:FrameCache,contactSheet=false):Promise<NonNullable<MediaTaskResult['snapshot']>> {
  const {timeline,times,baseline}=snapshot,frame=1/timeline.fps,last=Math.max(0,timelineDuration(timeline)-frame);
  const sceneMedia=new Set([...sceneMediaAssetIds(timeline),...baseline?sceneMediaAssetIds(baseline):[]]);
  const assets=snapshot.assets.filter(asset=>asset._id===timeline.audioNormalization?.assetId||asset._id===baseline?.audioNormalization?.assetId||sceneMedia.has(asset._id)||[...timeline.clips,...baseline?.clips??[]].some(clip=>clip.assetId===asset._id||clip.normalizedAudio?.assetId===asset._id)) as (MediaAsset & {size:number})[];
  const range=snapshot.pacing??snapshot.sound??snapshot.motion;
  const windows=contactSheet?[{start:0,end:last+frame}]:range?[{start:Math.max(0,range.start-.5),end:Math.min(last+frame,range.end+.5)}]:times.map(time=>({start:Math.max(0,Math.min(time,last)),end:Math.min(time,last)+frame}));
  const {assetUrls,audioSourceOffsets}=await prepareComposition(directory,timeline,assets,convexUrl,signal,baseline?[baseline]:[],windows);
  // Listening to a range needs only its decoded audio, not a page.
  if(snapshot.sound&&!snapshot.sound.check){onProgress(40);return {frames:[],sound:await measureTimelineSound(snapshot,directory,assetUrls,audioSourceOffsets,{start:snapshot.sound.start,end:Math.min(snapshot.sound.end,timelineDuration(timeline))},signal)};}
  const path=join(directory,'edited');await mkdir(path);await linkCompositionResources(directory,path,assetUrls);
  const resolution=snapshot.resolution??(snapshot.comparison&&!snapshot.motion?1080:720),size=dimensions(timeline.aspectRatio,resolution);
  await writeComposition(path,timeline,assets,assetUrls,resolution,timeline.fps as 24|30|60,'./',signal,audioSourceOffsets);
  onProgress(20);
  if(baseline)return guardFrames(snapshot,baseline,directory,path,assets,assetUrls,audioSourceOffsets,signal,onProgress);
  // One capture session over the whole range at the sampling rate, read back as small grayscale frames.
  const sampled=async(range:{start:number;end:number},fps:number)=>{
    const start=Math.round(Math.min(range.start,last)*timeline.fps)/timeline.fps,end=Math.min(range.end,last);
    const times=Array.from({length:Math.floor((end-start)*fps+1e-6)+1},(_,index)=>Math.round((start+index/fps)*timeline.fps)/timeline.fps);
    if(times.length<3)throw new AnalysisError('Check at least 0.3 s.',400);
    const crop=snapshot.comparison?.crop,aspect=snapshot.comparison?.aspectRatio??size.width*(crop?.w??1)/(size.height*(crop?.h??1));
    const width=320,height=Math.max(2,Math.round(width/aspect));
    const frames:Uint8Array[]=[];
    // Bound video extraction and capture to four seconds, preserving every sample and the original film clock.
    const perChunk=Math.max(1,Math.floor(4*fps));
    for(let first=0;first<times.length;first+=perChunk){
      const group=times.slice(first,first+perChunk);
      await runCompositionCapture(directory,{...size,fps:timeline.fps,times:group,start:group[0],end:group[group.length-1]+frame,variants:['edited'],pacing:{width,height,...(snapshot.comparison?.crop?{crop:snapshot.comparison.crop}:{})}},signal);
      const bytes=await readFile(join(directory,'pacing.bin'));
      if(bytes.length!==group.length*width*height)throw new AnalysisError('The picture check returned an incomplete frame buffer.',500);
      frames.push(...group.map((_,index)=>new Uint8Array(bytes.buffer,bytes.byteOffset+index*width*height,width*height)));
      onProgress(20+Math.round(65*Math.min(first+group.length,times.length)/times.length));
    }
    return {width,height,start:times[0],frames};
  };
  if(snapshot.motion){
    const fps=Math.min(30,timeline.fps),{width,height,start,frames}=await sampled({start:Math.max(0,snapshot.motion.start-.5),end:Math.min(last,snapshot.motion.end+.5)},fps);
    return {frames:[],motion:motionWindow(mapMotion(frames,width,height,start,fps),snapshot.motion.start,snapshot.motion.end)};
  }
  if(snapshot.pacing){
    const {width,height,start,frames}=await sampled(snapshot.pacing,snapshot.pacing.fps);
    return {frames:[],pacing:measurePacing(frames,width,height,start,snapshot.pacing.fps)};
  }
  if(snapshot.sound){
    const fps=snapshot.sound.fps??Math.min(30,timeline.fps),{start,frames}=await sampled(snapshot.sound,fps);
    const hits=visualHits(frames,start,fps);
    return {frames:[],sound:await measureTimelineSound(snapshot,directory,assetUrls,audioSourceOffsets,{start:snapshot.sound.start,end:Math.min(snapshot.sound.end,timelineDuration(timeline))},signal,{fps,hits})};
  }
  const frames:NonNullable<MediaTaskResult['snapshot']>['frames']=[];
  const at=times.map(requested=>Math.round(Math.min(Math.max(0,requested),last)*timeline.fps)/timeline.fps);
  const capture = async (indices:number[]):Promise<Buffer[]> => {
    const images = new Map<number,Buffer>();
    if(contactSheet){
      const group=indices.map(index=>({time:at[index],index})).sort((a,b)=>a.time-b.time);
      await runCompositionCapture(directory,{...size,fps:timeline.fps,times:group.map(item=>item.time),start:group[0].time,end:group.at(-1)!.time+frame,variants:['edited'],sparse:true},signal);
      for(const [sample,item] of group.entries())images.set(item.index,await readFile(join(path,`sample-${sample}.png`)));
      onProgress(95);
    }else if(!timeline.clips.some(clip=>clip.kind==='video')){
      // Scene samples within three seconds share the same capture, just as uncached requests do.
      const order=indices.map(index=>({time:at[index],index})).sort((a,b)=>a.time-b.time);
      for(let first=0;first<order.length;){
        let next=first;while(next+1<order.length&&order[next+1].time+frame-order[first].time<=3)next++;
        const group=order.slice(first,next+1);
        await runCompositionCapture(directory,{...size,fps:timeline.fps,times:group.map(item=>item.time),start:group[0].time,end:group[group.length-1].time+frame,variants:['edited']},signal);
        for(const [sample,item] of group.entries())images.set(item.index,await readFile(join(path,`sample-${sample}.png`)));
        first=next+1;onProgress(20+Math.round(75*first/order.length));
      }
    }else for(const [done,index] of indices.entries()){
      const time=at[index];
      await runCompositionCapture(directory,{...size,fps:timeline.fps,times:[time],start:time,end:time+frame,variants:['edited']},signal);
      images.set(index,await readFile(join(path,'sample-0.png')));
      onProgress(20+Math.round(75*(done+1)/indices.length));
    }
    return indices.map(index=>images.get(index)!);
  };
  const descriptors=at.map(time=>({kind:'timeline-png',identity:snapshot.cacheIdentity,frameIndex:Math.round(time*timeline.fps),width:size.width,height:size.height,format:'png'}));
  const images:Buffer[]=[];
  if(cache&&snapshot.cacheIdentity){
    for(let first=0;first<at.length;first+=30)images.push(...await cache.batch(descriptors.slice(first,first+30),missing=>capture(missing.map(index=>first+index))));
  }else images.push(...await capture(at.map((_,index)=>index)));
  for(const [index,time] of at.entries())frames.push({time,image:images[index].toString('base64')});
  if(snapshot.card)return {frames:[{time:frames[0].time,image:(await shareCard(Buffer.from(frames[0].image,'base64'),snapshot.card.title)).toString('base64')}]};
  // Keep the existing tool image budget and encoding; cached PNGs are never replaced by these smaller JPEGs.
  const pngs=await Promise.all(frames.map(async frame=>{
    const image=Buffer.from(frame.image,'base64'),crop=snapshot.comparison?.crop;
    if(!crop)return image;
    const meta=await sharp(image).metadata();
    if(!meta.width||!meta.height)throw new AnalysisError('The comparison frame has no dimensions.',500);
    return sharp(image).extract(cropBounds(crop,meta.width,meta.height)).png().toBuffer();
  }));
  if(snapshot.resolution===1080){
    for(const quality of [85,75,65,55,45,35]){
      const images=await Promise.all(pngs.map(png=>sharp(png).jpeg({quality}).toBuffer().then(buffer=>buffer.toString('base64'))));
      if(images.reduce((sum,image)=>sum+image.length,0)<=700_000)return {frames:frames.map((frame,index)=>({time:frame.time,image:images[index],width:size.width,height:size.height}))};
    }
    throw new AnalysisError('The 1080p frame exceeds the inspection image budget; use a preview or inspect a different time.',400);
  }
  for(const [size,quality] of (snapshot.comparison?[[1920,85],[1280,85],[1080,80],[768,75],[640,65],[512,55],[384,45]]:[[768,70],[640,60],[512,50],[384,45]])){
    const images=await Promise.all(pngs.map(png=>sharp(png).resize(size,size,{fit:'inside',withoutEnlargement:true}).jpeg({quality}).toBuffer().then(buffer=>buffer.toString('base64'))));
    if(images.reduce((sum,image)=>sum+image.length,0)<=(snapshot.comparison?600_000:700_000))return {frames:frames.map((frame,index)=>({time:frame.time,image:images[index]}))};
  }
  throw new AnalysisError('Rendered frames are too detailed to return. Ask for fewer times.',400);
}

/** The visual guard: the saved timeline (reference) and a proposed change (edited) captured with the same seeks, one
 * capture session per 3 s span; returns how much of each frame changed, and the most changed moments side by side. */
async function guardFrames(snapshot:NonNullable<MediaWorkItem['snapshot']>,baseline:NonNullable<NonNullable<MediaWorkItem['snapshot']>['baseline']>,directory:string,edited:string,assets:(MediaAsset & {size:number})[],assetUrls:Awaited<ReturnType<typeof prepareComposition>>['assetUrls'],audioSourceOffsets:Awaited<ReturnType<typeof prepareComposition>>['audioSourceOffsets'],signal:AbortSignal,onProgress:(n:number)=>void):Promise<NonNullable<MediaTaskResult['snapshot']>> {
  const {timeline}=snapshot,frame=1/timeline.fps,last=Math.max(0,Math.min(timelineDuration(timeline),timelineDuration(baseline))-frame),size=dimensions(timeline.aspectRatio,720);
  const reference=join(directory,'reference');await mkdir(reference);await linkCompositionResources(directory,reference,assetUrls);
  await writeComposition(reference,baseline,assets,assetUrls,720,timeline.fps as 24|30|60,'./',signal,audioSourceOffsets);
  const at=snapshot.times.map(time=>Math.round(Math.min(Math.max(0,time),last)*timeline.fps)/timeline.fps);
  const span=timeline.clips.some(clip=>clip.kind==='video')||baseline.clips.some(clip=>clip.kind==='video')?0:3;
  const order=at.map((time,index)=>({time,index})).sort((a,b)=>a.time-b.time),pairs=new Array<{before:Buffer;after:Buffer;difference:number}>(at.length);
  for(let first=0;first<order.length;){
    let next=first;while(next+1<order.length&&order[next+1].time+frame-order[first].time<=span)next++;
    const group=order.slice(first,next+1);
    await runCompositionCapture(directory,{...size,fps:timeline.fps,times:group.map(item=>item.time),start:group[0].time,end:group[group.length-1].time+frame,variants:['edited','reference']},signal);
    for(const [sample,item] of group.entries()){
      const [after,before]=await Promise.all([edited,reference].map(dir=>readFile(join(dir,`sample-${sample}.png`))));
      const [a,b]=await Promise.all([after,before].map(buffer=>sharp(buffer).resize(320,Math.max(2,Math.round(320*size.height/size.width)),{fit:'fill'}).removeAlpha().raw().toBuffer()));
      pairs[item.index]={before,after,difference:Math.round(changedShare(a,b)*10000)/10000};
    }
    first=next+1;onProgress(20+Math.round(75*first/order.length));
  }
  // Before on the left, after on the right, for the most changed moments only.
  const worst=pairs.map((pair,index)=>({...pair,index})).filter(pair=>pair.difference>0).sort((a,b)=>b.difference-a.difference).slice(0,3).sort((a,b)=>a.index-b.index);
  const width=640,height=Math.round(width*size.height/size.width);
  const frames=await Promise.all(worst.map(async pair=>{
    const [left,right]=await Promise.all([pair.before,pair.after].map(png=>sharp(png).resize(width,height,{fit:'fill'}).toBuffer()));
    const image=await sharp({create:{width:width*2+8,height,channels:3,background:'#2a2a2a'}}).composite([{input:left,left:0,top:0},{input:right,left:width+8,top:0}]).jpeg({quality:70}).toBuffer();
    return {time:at[pair.index],image:image.toString('base64')};
  }));
  return {frames,differences:pairs.map(pair=>pair.difference)};
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
