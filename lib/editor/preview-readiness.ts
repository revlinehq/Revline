/** A painted player shell is not proof that the current media frame has decoded. */
export async function waitForPreviewMedia(document:Document,time:number,signal:AbortSignal,onThumbnail?:(url:string)=>void) {
  const media=Array.from(document.querySelectorAll<HTMLMediaElement>('video[data-start],audio[data-start]')).filter(node=>time>=Number(node.dataset.start)&&time<Number(node.dataset.end??Number(node.dataset.start)+Number(node.dataset.duration)));
  await Promise.all(media.map(node=>new Promise<void>((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);for(const name of ['loadeddata','canplay','seeked','error'])node.removeEventListener(name,check);signal.removeEventListener('abort',abort);};
    const abort=()=>{cleanup();reject(signal.reason??new DOMException('Cancelled','AbortError'));};
    const check=()=>{
      if(node.error){cleanup();reject(new Error('This footage could not be loaded. Please retry.'));return;}
      if(node.readyState<2||node.seeking)return;
      if(node.tagName==='VIDEO'&&onThumbnail)try{const video=node as HTMLVideoElement,canvas=document.createElement('canvas');const scale=Math.min(352/video.videoWidth,352/video.videoHeight,1);canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));canvas.getContext('2d')?.drawImage(video,0,0,canvas.width,canvas.height);onThumbnail(canvas.toDataURL('image/jpeg',.7));}catch{/* Playback can still work when a source cannot be captured. */}
      cleanup();resolve();
    };
    const timer=setTimeout(()=>{cleanup();reject(new Error('The footage is taking too long to load. Please retry.'));},20_000);
    for(const name of ['loadeddata','canplay','seeked','error'])node.addEventListener(name,check);
    signal.addEventListener('abort',abort,{once:true});node.preload='auto';if(signal.aborted)abort();else check();
  })));
}
