// Capture bounded edited/reference samples with the same seek, FFmpeg frame
// injection and screenshot engine as export, in an isolated renderer process.
import { readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createCaptureSession, initializeSession, closeCaptureSession, captureFrameToBuffer, createVideoFrameInjector,createFileServer } from '@hyperframes/producer';
import { parseVideoElements, extractAllVideoFrames, createFrameLookupTable } from '@hyperframes/engine';
import { shiftRateLane, sourceTimeAt } from '@hyperframes/core';
import sharp from 'sharp';
import { microseconds } from '../lib/ffmpeg-time.mjs';
const [directory,serialized]=process.argv.slice(2),settings=JSON.parse(serialized);
const root=resolve(directory),controller=new AbortController();
process.on('SIGTERM',()=>controller.abort());process.on('disconnect',()=>controller.abort());
const report=message=>{if(process.connected)process.send(message);};
try{
  // Frame snapping can differ from an equivalent window bound by a few ULPs.
  // Keep the capture bounded while accepting that numerical round-off only.
  const tolerance=1e-7;
  if(!directory||!Number.isInteger(settings.width)||!Number.isInteger(settings.height)||![24,30,60].includes(settings.fps)||!Number.isFinite(settings.start)||!Number.isFinite(settings.end)||settings.start<0||settings.end<=settings.start||!Array.isArray(settings.times)||!settings.times.length||settings.times.some(t=>!Number.isFinite(t)||t<settings.start-tolerance||t>settings.end+tolerance)||!settings.pacing&&(settings.times.length>(settings.sparse?180:12)||settings.end-settings.start>(settings.sparse?60.00001:3.00001)))throw new Error('Invalid bounded review settings.');
  // Timeline snapshots render the edited composition only.
  const variants=settings.variants===undefined?['edited','reference']:settings.variants;
  if(!Array.isArray(variants)||!variants.length||variants.some(variant=>variant!=='edited'&&variant!=='reference'))throw new Error('Invalid capture variants.');
  // Pacing reads every sample as a small grayscale frame, all in one file, instead of a PNG each.
  const crop=settings.pacing?.crop;
  const pacing=settings.pacing?{width:settings.pacing.width,height:settings.pacing.height??Math.max(2,Math.round(settings.pacing.width*settings.height*(crop?.h??1)/(settings.width*(crop?.w??1)))),frames:[]}:undefined;
  const safe=[];
  for(const variant of variants){
    const dir=join(root,variant),html=await readFile(join(dir,'index.html'),'utf8');
    // Clip bounds and the window come from different float sums, so a clip that
    // ends where the window starts can overlap it by a sliver (3e-7s). The engine
    // hands FFmpeg `-t String(duration)`, which comes out in exponent form and
    // fails the whole decode (and every mirror copy sharing it). Snap to
    // microseconds and decode at least one whole frame of any overlapping clip.
    const frame=1/settings.fps;
    const videos=parseVideoElements(html).filter(video=>video.start<settings.end&&video.end>settings.start).map(video=>{
      const start=microseconds(Math.max(settings.start,video.start)),end=Math.max(microseconds(Math.min(settings.end,video.end)),microseconds(start+frame));
      // A speed ramp (a rate lane) is cut to the window with the engine's own source-time mapping.
      const rate=video.playbackRate??1,skipped=start-video.start;
      // Composition attributes use microseconds; avoid scientific-notation seeks FFmpeg rejects.
      return {...video,start,end,mediaStart:Math.round((video.mediaStart+sourceTimeAt(rate,skipped))*1e6)/1e6,playbackRate:typeof rate==='number'?rate:shiftRateLane(rate,skipped)};
    });
    let extracted;
    if(settings.sparse){
      // A clipping sheet needs only these source frames, not every frame in
      // the 60s span. Decode bounded one-frame windows, then share one browser.
      const sparse=[];
      for(const video of videos){
        const paths=new Map();let template;
        for(const [index,time] of settings.times.entries()){
          if(time<video.start-tolerance||time>=video.end-tolerance)continue;
          const rate=video.playbackRate??1,skipped=time-video.start;
          // One whole frame from the sample; a sliver to the clip's end would reach FFmpeg as an exponent.
          const local={...video,start:microseconds(time),end:microseconds(time+1/settings.fps),mediaStart:Math.round((video.mediaStart+sourceTimeAt(rate,skipped))*1e6)/1e6,playbackRate:typeof rate==='number'?rate:shiftRateLane(rate,skipped)};
          const part=await extractAllVideoFrames([local],dir,{fps:{num:settings.fps,den:1},outputDir:join(dir,'frames',String(index)),format:'png',toneMapHdrToSdr:true,timelineEnd:local.end},controller.signal);
          if(part.errors?.length)throw new Error(`Clipping-sheet source frame could not be decoded: ${part.errors.map(({videoId,kind,error})=>`${videoId} (${kind}): ${error}`).join('; ')}`);
          if(!part.extracted[0]?.framePaths.size)throw new Error('A requested clipping-sheet source frame could not be decoded.');
          template=part.extracted[0];paths.set(Math.floor(sourceTimeAt(rate,skipped)*settings.fps+1e-9),template.framePaths.values().next().value);
        }
        if(template)sparse.push({...template,videoId:video.id,fps:settings.fps,totalFrames:Math.ceil(sourceTimeAt(video.playbackRate??1,video.end-video.start)*settings.fps),framePaths:paths});
      }
      extracted={extracted:sparse};
    }else extracted=await extractAllVideoFrames(videos,dir,{fps:{num:settings.fps,den:1},outputDir:join(dir,'frames'),format:'png',toneMapHdrToSdr:true,timelineEnd:Math.max(settings.end,...videos.map(video=>video.end))},controller.signal);
    if(extracted.errors?.length)throw new Error(`Video frames could not be decoded for review: ${extracted.errors.map(({videoId,kind,error})=>`${videoId} (${kind}): ${error}`).join('; ')}`);
    const injector=createVideoFrameInjector(createFrameLookupTable(videos,extracted.extracted,settings.fps));
    const server=await createFileServer({projectDir:dir,fps:{num:settings.fps,den:1}});
    const origin=server.url;
    let session;
    try{
      session=await createCaptureSession(origin,dir,{width:settings.width,height:settings.height,fps:{num:settings.fps,den:1},format:pacing?'jpeg':'png',...(pacing?{deviceScaleFactor:Math.min(1,pacing.width/(settings.width*(crop?.w??1))),quality:75}:{}),compositionDurationSeconds:settings.end},injector);
      await session.page.setRequestInterception(true);
      session.page.on('request',request=>request.url().startsWith(origin+'/')||request.url().startsWith('data:')?request.continue():request.abort());
      await initializeSession(session);
      for(const [index,time] of settings.times.entries()){
        controller.signal.throwIfAborted();
        const frame=await captureFrameToBuffer(session,Math.round(time*settings.fps),time);
        if(pacing){
          let image=sharp(frame.buffer);
          if(crop){const meta=await image.metadata(),left=Math.min(meta.width-1,Math.floor(crop.x*meta.width)),top=Math.min(meta.height-1,Math.floor(crop.y*meta.height));image=image.extract({left,top,width:Math.max(1,Math.min(meta.width-left,Math.round(crop.w*meta.width))),height:Math.max(1,Math.min(meta.height-top,Math.round(crop.h*meta.height)))});}
          pacing.frames.push(await image.resize(pacing.width,pacing.height,{fit:'fill'}).removeAlpha().grayscale().raw().toBuffer());continue;
        }
        await writeFile(join(dir,`sample-${index}.png`),frame.buffer);
        if(variant==='edited')safe.push(await session.page.evaluate(()=>{
          const container=document.getElementById('composition').getBoundingClientRect();
          return [...document.querySelectorAll('[data-text-clip]')].flatMap(element=>{
            const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);const bounds=[];let node;
            while(node=walker.nextNode()){if(!node.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(node);for(const rect of range.getClientRects())if(rect.width&&rect.height)bounds.push(rect);}
            if(!bounds.length||getComputedStyle(element).opacity==='0'||getComputedStyle(element).visibility==='hidden')return [];
            return [{clipId:element.getAttribute('data-text-clip'),safe:bounds.every(r=>r.left>=container.left+container.width*.05&&r.right<=container.right-container.width*.05&&r.top>=container.top+container.height*.05&&r.bottom<=container.bottom-container.height*.05)}];
          });
        }));
      }
    }finally{try{if(session)await closeCaptureSession(session);}finally{server.close();await rm(join(dir,'frames'),{recursive:true,force:true});}}
  }
  if(pacing)await writeFile(join(root,'pacing.bin'),Buffer.concat(pacing.frames));
  await writeFile(join(root,'text-safe.json'),JSON.stringify(safe));report({type:'complete',warnings:0});
}catch(error){report({type:'error',message:error instanceof Error?error.message.slice(0,800):'Composition capture failed.'});process.exitCode=1;}
finally{if(process.connected)process.disconnect();}
process.exit(process.exitCode??0);
