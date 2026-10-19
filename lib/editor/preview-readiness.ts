export function previewMediaReady(node:HTMLMediaElement,time:number) {
  if(node.readyState<2||node.seeking)return false;
  // Footage deliberately held at its final decoded frame has no future data.
  if(Number.isFinite(node.duration)&&node.duration-node.currentTime<=.05)return true;
  if(node.readyState<3)return false;
  const end=Number(node.dataset.end??Number(node.dataset.start)+Number(node.dataset.duration));
  if(!Number.isFinite(end))return true;
  const rate=Number(node.dataset.playbackRate??1);
  const runway=Math.min(1.5,Math.max(0,end-time))*(Number.isFinite(rate)&&rate>0?rate:1);
  const target=Math.min(node.currentTime+runway,Number.isFinite(node.duration)?node.duration:Infinity);
  for(let index=0;index<node.buffered.length;index++)if(node.buffered.start(index)<=node.currentTime+.025&&node.buffered.end(index)>=target-.025)return true;
  return false;
}

/** A decoded first frame alone can still stall as soon as playback starts. */
export async function waitForPreviewMedia(document:Document,time:number,signal:AbortSignal,onThumbnail?:(url:string)=>void,onSlow?:()=>void) {
  const transitions=(document.defaultView as (Window & {__revlineTransitionController?:{whenReady(time:number,signal:AbortSignal):Promise<void>}})|null)?.__revlineTransitionController;
  const media=Array.from(document.querySelectorAll<HTMLMediaElement>('video[data-start],audio[data-start]')).filter(node=>(node.tagName!=='AUDIO'||Number(node.dataset.volume??1)>0)&&time>=Number(node.dataset.start)&&time<Number(node.dataset.end??Number(node.dataset.start)+Number(node.dataset.duration)));
  await Promise.all([transitions?.whenReady(time,signal),...media.map(node=>new Promise<void>((resolve,reject)=>{
    const events=['loadedmetadata','loadeddata','canplay','progress','durationchange','seeked','error'];
    let idleTimer:ReturnType<typeof setTimeout>;
    const cleanup=()=>{clearTimeout(idleTimer);for(const name of events)node.removeEventListener(name,check);signal.removeEventListener('abort',abort);};
    const abort=()=>{cleanup();reject(signal.reason??new DOMException('Cancelled','AbortError'));};
    const delayed=()=>{
      console.warn('[Revline playback readiness]', JSON.stringify({ reason:'slow', sourceClip:node.dataset.sourceClip, readyState:node.readyState, networkState:node.networkState, sourceTime:node.currentTime, seeking:node.seeking }));
      // A slow range seek is still recoverable. Keep listening for real media
      // readiness instead of rejecting a source that can finish loading later.
      onSlow?.();
    };
    const progress=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(delayed,30_000);};
    const check=(event?:Event)=>{
      // A cold, trimmed source may need several range requests before decoding.
      // Browser progress and decode events show activity, not a failed source.
      if(event&&event.type!=='error')progress();
      if(node.error){cleanup();reject(new Error('This footage could not be loaded. Please retry.'));return;}
      if(!previewMediaReady(node,time))return;
      if(node.tagName==='VIDEO'&&onThumbnail)try{const video=node as HTMLVideoElement,canvas=document.createElement('canvas');const scale=Math.min(352/video.videoWidth,352/video.videoHeight,1);canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));canvas.getContext('2d')?.drawImage(video,0,0,canvas.width,canvas.height);onThumbnail(canvas.toDataURL('image/jpeg',.7));}catch{/* Playback can still work when a source cannot be captured. */}
      cleanup();resolve();
    };
    progress();
    for(const name of events)node.addEventListener(name,check);
    signal.addEventListener('abort',abort,{once:true});node.preload='auto';if(signal.aborted)abort();else check();
  }))]);
}
