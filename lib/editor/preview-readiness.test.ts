import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { waitForPreviewMedia } from './preview-readiness';

class Media extends EventTarget {
  dataset={start:'0',end:'10',playbackRate:'1'};
  tagName='VIDEO';readyState=3;seeking=false;error=null;preload='';currentTime=0;duration=10;
  ranges=[[0,1]];
  get buffered(){return{length:this.ranges.length,start:(i:number)=>this.ranges[i][0],end:(i:number)=>this.ranges[i][1]};}
}
const documentFor=(media:Media)=>({querySelectorAll:()=>[media]} as unknown as Document);
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());

test('initial preview waits beyond a decoded frame until a small playable runway is buffered',async()=>{
  const media=new Media();let ready=false;
  const pending=waitForPreviewMedia(documentFor(media),0,new AbortController().signal).then(()=>{ready=true;});
  await Promise.resolve();await Promise.resolve();expect(ready).toBe(false);
  media.ranges=[[0,1.5]];media.dispatchEvent(new Event('progress'));await pending;expect(ready).toBe(true);
});

test('runway follows source position and playback rate, bounded by the retained clip end',async()=>{
  const media=new Media();media.dataset={start:'2',end:'5',playbackRate:'2'};media.currentTime=10;media.duration=20;media.ranges=[[10,11.5]];
  let ready=false;const pending=waitForPreviewMedia(documentFor(media),4,new AbortController().signal).then(()=>{ready=true;});
  await Promise.resolve();await Promise.resolve();expect(ready).toBe(false);
  media.ranges=[[10,12]];media.dispatchEvent(new Event('progress'));await pending;
});

test('a short source tail does not wait for nonexistent media beyond the source end',async()=>{
  const media=new Media();media.currentTime=9.8;media.ranges=[[9.8,10]];
  await waitForPreviewMedia(documentFor(media),0,new AbortController().signal);
});

test('a retained last decoded frame can remain visible at the source end',async()=>{
  const media=new Media();media.currentTime=10;media.readyState=2;media.ranges=[];
  await waitForPreviewMedia(documentFor(media),0,new AbortController().signal);
});

test('unbounded media still needs canplay, without requiring an impossible finite runway',async()=>{
  const media=new Media();media.dataset.end='Infinity';media.duration=Infinity;media.readyState=2;
  let ready=false;const pending=waitForPreviewMedia(documentFor(media),0,new AbortController().signal).then(()=>{ready=true;});
  await Promise.resolve();await Promise.resolve();expect(ready).toBe(false);
  media.readyState=3;media.dispatchEvent(new Event('canplay'));await pending;
});

test('an interrupted startup wait rejects and removes its pending progress listener',async()=>{
  const media=new Media(),controller=new AbortController(),remove=vi.spyOn(media,'removeEventListener');
  const pending=waitForPreviewMedia(documentFor(media),0,controller.signal);controller.abort();
  await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(remove).toHaveBeenCalledWith('progress',expect.any(Function));
});
