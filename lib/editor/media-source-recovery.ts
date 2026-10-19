import { previewMediaReady } from './preview-readiness';

export type RefreshPlaybackMedia = (assetIds:string[]) => Promise<{_id:string;url:string|null}[]>;

/** Recover a native fetch/seek that stops making progress without emitting an error. */
export function watchPreviewMediaStalls(document:Document,readTime:()=>number,repair:(media:HTMLMediaElement)=>Promise<void>){
  const states=new WeakMap<HTMLMediaElement,{signature:string;progressAt:number;attempts:number}>();
  let disposed=false,repairing=false;
  const progress=(event:Event)=>{const state=states.get(event.target as HTMLMediaElement);if(state)state.progressAt=Date.now();};
  document.addEventListener('progress',progress,true);
  const check=()=>{
    if(disposed||repairing)return;
    const time=readTime(),now=Date.now();
    for(const media of document.querySelectorAll<HTMLMediaElement>('video[data-start],audio[data-start]')){
      const start=Number(media.dataset.start),end=start+Number(media.dataset.duration);
      if(!media.isConnected||media.error||time<start||time>=end||media.tagName==='AUDIO'&&Number(media.dataset.volume??1)===0)continue;
      if(previewMediaReady(media,time)){states.delete(media);continue;}
      const ranges=[];for(let i=0;i<media.buffered.length;i++)ranges.push([media.buffered.start(i),media.buffered.end(i)]);
      const signature=JSON.stringify([media.readyState,media.seeking,media.currentTime,ranges]);
      let state=states.get(media);
      if(!state){state={signature,progressAt:now,attempts:0};states.set(media,state);}
      if(state.signature!==signature){state.signature=signature;state.progressAt=now;continue;}
      if(now-state.progressAt<8000||state.attempts>=2)continue;
      state.attempts++;state.progressAt=now;repairing=true;
      console.warn('[Revline playback recovery]',JSON.stringify({reason:'no media progress',id:media.dataset.sourceClip,readyState:media.readyState,networkState:media.networkState,seeking:media.seeking,attempt:state.attempts}));
      const stalled=state;
      void Promise.resolve().then(()=>repair(media)).catch(()=>{}).finally(()=>{repairing=false;stalled.progressAt=Date.now();});
      break;
    }
  };
  const timer=setInterval(check,500);
  return()=>{disposed=true;clearInterval(timer);document.removeEventListener('progress',progress,true);};
}

function mediaEvent(media:HTMLMediaElement,event:string,signal:AbortSignal) {
  return new Promise<void>((resolve,reject)=>{
    const finish=(error?:Error)=>{clearTimeout(timeout);media.removeEventListener(event,success);media.removeEventListener('error',failure);signal.removeEventListener('abort',abort);error?reject(error):resolve();};
    const success=()=>finish(),failure=()=>finish(new Error('The source could not be loaded.')),abort=()=>finish(new DOMException('Preview replaced.','AbortError'));
    const timeout=setTimeout(()=>finish(new Error('The source took too long to load.')),15_000);
    media.addEventListener(event,success,{once:true});media.addEventListener('error',failure,{once:true});signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted)abort();
  });
}

/** Reload only a failed source, retaining its player, audio graph and timeline clock. */
export async function recoverMediaSource(media:HTMLMediaElement,url:string,options:{signal:AbortSignal;position:()=>number;playing:()=>boolean;redraw:()=>void}) {
  const {signal}=options,volume=media.volume,muted=media.muted,rate=media.playbackRate;
  signal.throwIfAborted();
  const metadata=mediaEvent(media,'loadedmetadata',signal);
  media.src=url;media.load();await metadata;
  signal.throwIfAborted();media.volume=volume;media.muted=muted;media.playbackRate=rate;
  const position=Math.max(0,Math.min(options.position(),Number.isFinite(media.duration)?Math.max(0,media.duration-1/120):Infinity));
  if(Math.abs(media.currentTime-position)>.001){const sought=mediaEvent(media,'seeked',signal);media.currentTime=position;await sought;}
  if(media.readyState<2)await mediaEvent(media,'loadeddata',signal);
  signal.throwIfAborted();options.redraw();
  if(options.playing())await media.play();else media.pause();
}
