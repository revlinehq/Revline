// Capture bounded edited/reference samples with the same seek, FFmpeg frame
// injection and screenshot engine as export, in an isolated renderer process.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createCaptureSession, initializeSession, closeCaptureSession, captureFrameToBuffer, createVideoFrameInjector,createFileServer } from '@hyperframes/producer';
import { parseVideoElements, extractAllVideoFrames, createFrameLookupTable } from '@hyperframes/engine';
const [directory,serialized]=process.argv.slice(2),settings=JSON.parse(serialized);
const root=resolve(directory),controller=new AbortController();
process.on('SIGTERM',()=>controller.abort());process.on('disconnect',()=>controller.abort());
const report=message=>{if(process.connected)process.send(message);};
try{
  if(!directory||!Number.isInteger(settings.width)||!Number.isInteger(settings.height)||![24,30,60].includes(settings.fps)||!Array.isArray(settings.times)||!settings.times.length||settings.times.length>12||settings.times.some(t=>!Number.isFinite(t)||t<settings.start||t>settings.end)||settings.end-settings.start>3.00001)throw new Error('Invalid bounded review settings.');
  const safe=[];
  for(const variant of ['edited','reference']){
    const dir=join(root,variant),html=await readFile(join(dir,'index.html'),'utf8');
    const videos=parseVideoElements(html).filter(video=>video.start<settings.end&&video.end>settings.start).map(video=>{
      const start=Math.max(settings.start,video.start),end=Math.min(settings.end,video.end);
      if(typeof video.playbackRate!=='number'&&video.playbackRate!==undefined)throw new Error('Variable video rates are not supported in short review.');
      return {...video,start,end,mediaStart:video.mediaStart+(start-video.start)*(video.playbackRate??1)};
    });
    const extracted=await extractAllVideoFrames(videos,dir,{fps:{num:settings.fps,den:1},outputDir:join(dir,'frames'),format:'png',toneMapHdrToSdr:true,timelineEnd:settings.end},controller.signal);
    if(extracted.errors?.length)throw new Error('Video frames could not be decoded for review.');
    const injector=createVideoFrameInjector(createFrameLookupTable(videos,extracted.extracted,settings.fps));
    const server=await createFileServer({projectDir:dir,fps:{num:settings.fps,den:1}});
    const origin=server.url;
    const session=await createCaptureSession(origin,dir,{width:settings.width,height:settings.height,fps:{num:settings.fps,den:1},format:'png',compositionDurationSeconds:settings.end},injector);
    try{
      await session.page.setRequestInterception(true);
      session.page.on('request',request=>request.url().startsWith(origin+'/')||request.url().startsWith('data:')?request.continue():request.abort());
      await initializeSession(session);
      for(const [index,time] of settings.times.entries()){
        controller.signal.throwIfAborted();
        const frame=await captureFrameToBuffer(session,Math.round(time*settings.fps),time);
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
    }finally{await closeCaptureSession(session);await server.close();}
  }
  await writeFile(join(root,'text-safe.json'),JSON.stringify(safe));report({type:'complete',warnings:0});
}catch(error){report({type:'error',message:error instanceof Error?error.message.slice(0,800):'Composition capture failed.'});process.exitCode=1;}
finally{if(process.connected)process.disconnect();}
