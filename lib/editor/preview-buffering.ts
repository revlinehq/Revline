import { previewMediaReady } from './preview-readiness';

type Playback = EventTarget & { paused: boolean; play(): void; pause(): void };

/** A decoded first frame does not prevent a later network/decode stall. */
export function guardPreviewBuffering(document: Document, player: Playback, readTime: () => number, onBuffering?: () => void, onWaiting?: (waiting:boolean) => void) {
  let intended = !player.paused, held = false, disposed = false;
  let diagnosticTimer:ReturnType<typeof setTimeout>|undefined;
  let seekTimer:ReturnType<typeof setTimeout>|undefined;
  let recoveryTimer:ReturnType<typeof setInterval>|undefined;
  const clearRecovery=()=>{if(recoveryTimer!==undefined)clearInterval(recoveryTimer);recoveryTimer=undefined;};
  const clearSeek=()=>{if(seekTimer!==undefined)clearTimeout(seekTimer);seekTimer=undefined;};
  const clearDiagnostic=()=>{if(diagnosticTimer!==undefined)clearTimeout(diagnosticTimer);diagnosticTimer=undefined;};
  const blockedMedia = () => {
    const time = readTime();
    return Array.from(document.querySelectorAll<HTMLMediaElement>('video[data-start],audio[data-start]')).filter(node => {
      const start = Number(node.dataset.start), end = Number(node.dataset.end ?? start + Number(node.dataset.duration));
      // A source deliberately held past its own last frame cannot provide future data.
      const finished = !node.seeking && (node.ended || Number.isFinite(node.duration) && node.currentTime >= node.duration - .05);
      const silentAudio=node.tagName==='AUDIO'&&Number(node.dataset.volume??1)===0;
      return time >= start && time < end && !finished && !silentAudio && (node.seeking || node.readyState < 3 || held && !previewMediaReady(node,time));
    });
  };
  const blocked=()=>blockedMedia().length>0;
  const bufferedSeek=(node:HTMLMediaElement)=>{
    const end=Number(node.dataset.end),rate=Number(node.dataset.playbackRate??1);
    const runway=Math.min(.15,Math.max(0,end-readTime()))*rate;
    for(let index=0;index<node.buffered.length;index++)if(node.buffered.start(index)<=node.currentTime+.025&&node.buffered.end(index)>=node.currentTime+runway-.025)return true;
    return false;
  };
  const hold = () => {
    held = true;
    onWaiting?.(true);
    // Pausing the transport can consume the final canplay/seeked event before
    // its media sync has finished. Readiness can then settle without another
    // event, so an event-only hold never resumes even with decoded, buffered
    // footage. Poll only during the hold; readiness, not elapsed time, releases it.
    clearRecovery();recoveryTimer=setInterval(recover,100);
    if(onBuffering)diagnosticTimer=setTimeout(()=>{diagnosticTimer=undefined;if(!disposed&&held&&intended)try{onBuffering();}catch{/* Diagnostics must not interrupt media recovery. */}},2000);
  };
  const recover = () => {
    if(disposed||blocked())return;
    clearSeek();
    if (!held || !intended) return;
    held = false;clearDiagnostic();clearRecovery();
    onWaiting?.(false);
    player.play();
  };
  const waiting = (event: Event) => {
    if (disposed || !intended || held || player.paused) return;
    const node = event.target as HTMLMediaElement;
    if (!['VIDEO','AUDIO'].includes(node?.tagName) || !node.hasAttribute('data-start')) return;
    const stalled=blockedMedia();if(!stalled.length)return;
    // Native sync seeks emit waiting even when bytes are already buffered.
    // Pausing immediately seeks all media again, creating a pause/seek/restart
    // loop that chops both the picture and otherwise healthy background music.
    // Allow bounded decode settlement; genuine missing bytes still hold now.
    if(stalled.every(bufferedSeek)){
      if(seekTimer===undefined)seekTimer=setTimeout(()=>{seekTimer=undefined;if(!disposed&&intended&&!held&&!player.paused&&blocked()){hold();player.pause();}},120);
      return;
    }
    clearSeek();hold();
    // Audio can already be fully buffered and driving the transport clock.
    // Pause the shared transport rather than allowing it to outrun the picture.
    player.pause();
  };
  const played = () => { intended = true; };
  const paused = () => { if (!held) intended = false; };
  player.addEventListener('play', played); player.addEventListener('pause', paused); player.addEventListener('ended', paused);
  document.addEventListener('waiting', waiting, true);
  // canplay may mean only a fraction of a second is available after a distant
  // seek. Keep the hold until buffered runway is ready; progress can supply it
  // without another canplay/seeked event.
  for (const name of ['canplay', 'seeked', 'loadeddata', 'playing', 'ended', 'progress', 'canplaythrough', 'suspend']) document.addEventListener(name, recover, true);
  const play = () => {
    if(disposed)return;
    intended = true;
    if(held){recover();return;}
    // A scrub can already be seeking before Play, so no later waiting event
    // is guaranteed. Starting its audio clock now can repeatedly reseek a
    // decoder that has not landed, especially at accelerated clip rates.
    if(blocked()){hold();return;}
    player.play();
  };
  const cancel = () => { intended = false; held = false; clearSeek();clearDiagnostic();clearRecovery();onWaiting?.(false); };
  return {
    play,
    // Live edits can replace the active source while the user intends to keep
    // playing. Re-enter the readiness gate after the runtime's seek pauses it.
    resync(seek:()=>void) { const resume=held?intended:!player.paused;cancel();seek();if(resume)play(); },
    pause() { cancel();player.pause(); },
    cancel,
    isBuffering: () => held,
    isPlaying: () => !disposed && (held ? intended : !player.paused),
    dispose() {
      disposed = true; intended = false; held = false;clearSeek();clearDiagnostic();clearRecovery();
      player.removeEventListener('play', played); player.removeEventListener('pause', paused); player.removeEventListener('ended', paused);
      document.removeEventListener('waiting', waiting, true);
      for (const name of ['canplay', 'seeked', 'loadeddata', 'playing', 'ended', 'progress', 'canplaythrough', 'suspend']) document.removeEventListener(name, recover, true);
    },
  };
}
