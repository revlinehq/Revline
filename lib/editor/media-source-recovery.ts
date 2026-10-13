export type RefreshPlaybackMedia = (assetIds:string[]) => Promise<{_id:string;url:string|null}[]>;

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
