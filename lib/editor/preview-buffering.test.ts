import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { guardPreviewBuffering } from './preview-buffering';

class Player extends EventTarget {
  paused=false;
  play(){this.paused=false;this.dispatchEvent(new Event('play'));}
  pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}
}
function fixture(audioPending=false){
  const player=new Player(),diagnose=vi.fn(),listeners=new Map<string,EventListener>();
  const video={tagName:'VIDEO',dataset:{start:'0',end:'10'},readyState:1,seeking:true,currentTime:2,duration:20,ended:false,hasAttribute:(name:string)=>name==='data-start'};
  if(audioPending){video.readyState=4;video.seeking=false;}
  const audio={...video,tagName:'AUDIO',readyState:1,seeking:true};
  const document={querySelectorAll:()=>audioPending?[video,audio]:[video],addEventListener:(name:string,listener:EventListener)=>listeners.set(name,listener),removeEventListener:(name:string)=>listeners.delete(name)} as unknown as Document;
  const emit=(name:string)=>listeners.get(name)?.({target:video} as unknown as Event);
  const guard=guardPreviewBuffering(document,player,()=>2,diagnose);
  emit('waiting');
  return{player,diagnose,video,audio,emit,guard};
}
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());

test('a prolonged native buffer hold reports once and recovery preserves play intent',()=>{
  const f=fixture();expect(f.player.paused).toBe(true);expect(f.guard.isPlaying()).toBe(true);
  vi.advanceTimersByTime(1999);expect(f.diagnose).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);expect(f.diagnose).toHaveBeenCalledTimes(1);
  f.emit('waiting');vi.advanceTimersByTime(60_000);expect(f.diagnose).toHaveBeenCalledTimes(1);
  f.video.readyState=4;f.video.seeking=false;f.emit('canplay');expect(f.player.paused).toBe(false);
  f.video.readyState=1;f.emit('waiting');vi.advanceTimersByTime(2000);expect(f.diagnose).toHaveBeenCalledTimes(2);
  f.guard.dispose();
});

test.each(['recover','pause','cancel','dispose'] as const)('%s cancels the pending buffer diagnostic',action=>{
  const f=fixture();vi.advanceTimersByTime(1000);
  if(action==='recover'){f.video.readyState=4;f.video.seeking=false;f.emit('seeked');}
  else f.guard[action]();
  vi.advanceTimersByTime(2000);expect(f.diagnose).not.toHaveBeenCalled();
  if(action!=='dispose')f.guard.dispose();
});

test('Play waits for an already pending middle seek before starting the transport',()=>{
  const f=fixture();f.guard.pause();
  f.guard.play();expect(f.player.paused).toBe(true);expect(f.guard.isPlaying()).toBe(true);expect(f.guard.isBuffering()).toBe(true);
  f.video.readyState=4;f.video.seeking=false;f.emit('seeked');expect(f.player.paused).toBe(false);expect(f.guard.isBuffering()).toBe(false);
  f.guard.dispose();
});


test('a settled video cannot start while its active audio clock is still seeking',()=>{
  const f=fixture(true);f.guard.pause();f.guard.play();expect(f.player.paused).toBe(true);
  f.emit('canplay');expect(f.player.paused).toBe(true);
  f.audio.readyState=4;f.audio.seeking=false;f.emit('seeked');expect(f.player.paused).toBe(false);f.guard.dispose();
});

test.each(['pause','cancel'] as const)('%s cancels Play held before native decoding completes',action=>{
  const f=fixture();f.guard.pause();f.guard.play();f.guard[action]();
  f.video.readyState=4;f.video.seeking=false;f.emit('canplay');expect(f.player.paused).toBe(true);expect(f.guard.isPlaying()).toBe(false);f.guard.dispose();
});

test('a deliberately held decoded final source frame does not deadlock Play',()=>{
  const f=fixture();f.guard.pause();f.video.currentTime=20;f.video.readyState=2;f.video.seeking=false;
  f.guard.play();expect(f.player.paused).toBe(false);expect(f.guard.isBuffering()).toBe(false);f.guard.dispose();
});
