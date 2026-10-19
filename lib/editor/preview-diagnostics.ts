type Transport = EventTarget & { paused:boolean; pause?:()=>void };
type MediaSample = { events:Record<string,number>; frames:number; lastFrame?:number; maxFrameGap:number; sourceTime:number; frameCallback?:number; progressAt:number; seekAt?:number; bufferSignature:string; bufferChangedAt:number };

/** Development or explicitly opted-in client trace. Never records media URLs or contents. */
export function tracePreviewPlayback(document:Document,player:Transport,readTime:()=>number,state:()=>{playing:boolean;buffering:boolean},chatId:string) {
  const win=document.defaultView;
  if(!win)return()=>{};
  const media=new Map<HTMLMediaElement,MediaSample>();
  const probedSources=new Set<string>();
  const traceId=crypto.randomUUID().slice(0,8);
  const attachedAt=performance.now();
  const probeSource=(node:HTMLMediaElement)=>{
    const url=node.currentSrc||node.src;
    if(!url||probedSources.has(url)||probedSources.size>=4)return;
    probedSources.add(url);
    void (async()=>{
      const started=performance.now();
      try {
        const response=await fetch(url,{headers:{Range:'bytes=0-32767'},cache:'no-store',signal:AbortSignal.timeout(10000)});
        const reader=response.body?.getReader(),parts:Uint8Array[]=[];let length=0;
        try { while(reader&&length<32768){const next=await reader.read();if(next.done)break;const part=next.value.slice(0,32768-length);parts.push(part);length+=part.length;} }
        finally { await reader?.cancel(); }
        const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
        console.warn('[Revline playback source probe]',JSON.stringify({chatId,traceId,id:node.dataset.sourceClip,status:response.status,contentType:response.headers.get('content-type'),contentRange:response.headers.get('content-range'),bytes:length,sha256:hash,elapsedMs:Math.round(performance.now()-started)}));
      } catch(error) {
        console.warn('[Revline playback source probe]',JSON.stringify({chatId,traceId,id:node.dataset.sourceClip,errorType:error instanceof Error?error.name:'UnknownError',elapsedMs:Math.round(performance.now()-started)}));
      }
    })();
  };
  let stopped=false,previousWall=performance.now(),previousClock=readTime(),lastRaf=0,rafCount=0,maxRafGap=0,longTasks=0,longTaskMs=0,raf=0;
  const events=['loadstart','loadedmetadata','progress','suspend','waiting','stalled','seeking','seeked','playing','pause','error'];
  const buffered=(node:HTMLMediaElement)=>{const ranges:number[][]=[];for(let index=0;index<node.buffered.length&&ranges.length<6;index++)ranges.push([node.buffered.start(index),node.buffered.end(index)]);return ranges;};
  const snapshot=()=>{const time=readTime();return [...media.keys()].filter(node=>time>=Number(node.dataset.start)&&time<Number(node.dataset.end)).slice(0,8).map(node=>({id:node.dataset.sourceClip,kind:node.tagName,sourceTime:node.currentTime,ready:node.readyState,seeking:node.seeking,paused:node.paused,error:node.error?.code??null,buffered:buffered(node)}));};
  const transportEvent=(event:Event)=>console.warn('[Revline playback transport]',JSON.stringify({timestamp:new Date().toISOString(),chatId,traceId,event:event.type,clock:readTime(),paused:player.paused,...state(),media:snapshot()}));
  for(const name of ['play','pause','ended'])player.addEventListener(name,transportEvent);
  const originalPause=player.pause;
  const tracedPause=()=>{console.warn('[Revline playback pause call]',JSON.stringify({timestamp:new Date().toISOString(),chatId,traceId,clock:readTime(),...state(),media:snapshot(),stack:new Error().stack?.split('\n').slice(1,9)}));originalPause?.call(player);};
  if(originalPause)player.pause=tracedPause;
  function refresh() {
    for(const node of document.querySelectorAll<HTMLMediaElement>('video[data-start],audio[data-start]')) {
      if(media.has(node))continue;
      const now=performance.now();
      const sample:MediaSample={events:{},frames:0,maxFrameGap:0,sourceTime:node.currentTime,progressAt:now,bufferSignature:JSON.stringify(buffered(node)),bufferChangedAt:now};media.set(node,sample);
      if(node.tagName==='VIDEO'&&'requestVideoFrameCallback' in node){
        const video=node as HTMLVideoElement;
        const decoded=(now:number)=>{
          if(stopped||!video.isConnected)return;
          const time=readTime(),start=Number(video.dataset.start),end=Number(video.dataset.end);
          if(state().playing&&time>=start&&time<end){sample.frames++;if(sample.lastFrame!==undefined)sample.maxFrameGap=Math.max(sample.maxFrameGap,now-sample.lastFrame);sample.lastFrame=now;}
          else sample.lastFrame=undefined;
          sample.frameCallback=video.requestVideoFrameCallback(decoded);
        };
        sample.frameCallback=video.requestVideoFrameCallback(decoded);
      }
    }
    for(const [node,sample]of media)if(!node.isConnected){if(node.tagName==='VIDEO'&&sample.frameCallback!==undefined)(node as HTMLVideoElement).cancelVideoFrameCallback(sample.frameCallback);media.delete(node);}
  }
  const event=(event:Event)=>{
    const node=event.target as HTMLMediaElement,sample=media.get(node);if(!sample)return;
    sample.events[event.type]=(sample.events[event.type]??0)+1;
    const now=performance.now(),time=readTime();
    if(event.type==='progress'||event.type==='loadedmetadata')sample.progressAt=now;
    if(event.type==='seeking')sample.seekAt=now;
    if(event.type==='seeked')sample.seekAt=undefined;
    if(['waiting','stalled','seeking','seeked','error'].includes(event.type)&&time>=Number(node.dataset.start)&&time<Number(node.dataset.end))console.warn('[Revline playback media event]',JSON.stringify({timestamp:new Date().toISOString(),chatId,traceId,event:event.type,id:node.dataset.sourceClip,kind:node.tagName,clock:time,sourceTime:node.currentTime,ready:node.readyState,network:node.networkState,seeking:node.seeking,buffered:buffered(node)}));
    if(event.type==='error')probeSource(node);
  };
  for(const name of events)document.addEventListener(name,event,true);
  function tick(now:number){if(stopped)return;if(state().playing){rafCount++;if(lastRaf)maxRafGap=Math.max(maxRafGap,now-lastRaf);lastRaf=now;}else lastRaf=0;raf=win!.requestAnimationFrame(tick);}
  raf=win.requestAnimationFrame(tick);
  let observer:PerformanceObserver|undefined;
  try{observer=new PerformanceObserver(list=>{if(state().playing)for(const item of list.getEntries()){longTasks++;longTaskMs+=item.duration;}});observer.observe({type:'longtask',buffered:false});}catch{/* Not every browser exposes long tasks. */}
  refresh();
  const round=(n:number)=>Math.round(n*1000)/1000;
  const report=()=>{
    refresh();const now=performance.now(),time=readTime(),wallMs=now-previousWall,current=state();
    const samples=[...media].map(([node,sample])=>{
      const start=Number(node.dataset.start),end=Number(node.dataset.end),rate=Number(node.dataset.playbackRate??1);
      const active=time>=start&&time<end,expected=Number(node.dataset.mediaStart??0)+(time-start)*rate;
      const ranges=buffered(node),signature=JSON.stringify(ranges);
      if(signature!==sample.bufferSignature){sample.bufferSignature=signature;sample.bufferChangedAt=now;}
      const quality=node.tagName==='VIDEO'?(node as HTMLVideoElement).getVideoPlaybackQuality?.():undefined;
      // Native loading can stall without raising an error. Compare a bounded
      // fetch through the same browser with the stalled native media request.
      if(active&&node.readyState===0&&now-attachedAt>=10000)probeSource(node);
      const source=node.currentSrc||node.getAttribute('src');
      const output={id:node.dataset.sourceClip??node.id,kind:node.tagName,delivery:source?.startsWith('blob:')?'blob':source?'network':'none',active,sourceTime:round(node.currentTime),sourceAdvance:round(node.currentTime-sample.sourceTime),rate:node.playbackRate,expectedRate:rate,driftMs:active?Math.round((node.currentTime-expected)/rate*1000):null,ready:node.readyState,network:node.networkState,seeking:node.seeking,paused:node.paused,muted:node.muted,volume:round(node.volume),buffered:ranges,progressIdleMs:Math.round(now-sample.progressAt),bufferIdleMs:Math.round(now-sample.bufferChangedAt),seekAgeMs:node.seeking&&sample.seekAt!==undefined?Math.round(now-sample.seekAt):0,totalVideoFrames:quality?.totalVideoFrames,droppedVideoFrames:quality?.droppedVideoFrames,error:node.error?.code??null,errorMessage:node.error?.message.replace(/https?:\/\/[^\s"']+/g,'[media URL]').slice(0,300),decodedFrames:sample.frames,maxFrameGapMs:Math.round(sample.maxFrameGap),events:sample.events};
      sample.sourceTime=node.currentTime;sample.events={};sample.frames=0;sample.maxFrameGap=0;return output;
    }).filter(sample=>sample.active||sample.decodedFrames||Object.keys(sample.events).length).slice(0,16);
    if(current.playing||rafCount||samples.some(sample=>sample.active&&(sample.ready<3||sample.seeking)))console.warn('[Revline playback trace]',JSON.stringify({timestamp:new Date().toISOString(),chatId,traceId,visibility:document.visibilityState,clock:round(time),clockAdvance:round(time-previousClock),wallMs:Math.round(wallMs),...current,rafCount,maxRafGapMs:Math.round(maxRafGap),longTasks,longTaskMs:Math.round(longTaskMs),effectsCanvases:document.querySelectorAll('.visual-effect-output').length,media:samples}));
    previousWall=now;previousClock=time;rafCount=0;maxRafGap=0;longTasks=0;longTaskMs=0;
  };
  const timer=setInterval(report,2000);
  console.warn('[Revline playback trace]',JSON.stringify({event:'attached',timestamp:new Date().toISOString(),chatId,traceId,codecs:{h264:document.createElement('video').canPlayType('video/mp4; codecs="avc1.64002A"'),aac:document.createElement('audio').canPlayType('audio/mp4; codecs="mp4a.40.2"')}}));
  return()=>{stopped=true;clearInterval(timer);win.cancelAnimationFrame(raf);observer?.disconnect();if(player.pause===tracedPause)player.pause=originalPause;for(const name of ['play','pause','ended'])player.removeEventListener(name,transportEvent);for(const name of events)document.removeEventListener(name,event,true);for(const [node,sample]of media)if(node.tagName==='VIDEO'&&sample.frameCallback!==undefined)(node as HTMLVideoElement).cancelVideoFrameCallback(sample.frameCallback);media.clear();};
}
