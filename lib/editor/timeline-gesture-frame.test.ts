import { afterEach, expect, it, vi } from 'vitest';
import { timelineGestureFrame } from './timeline-gesture-frame';

afterEach(()=>vi.unstubAllGlobals());

function frameClock(){
  let id=0;const callbacks=new Map<number,FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{callbacks.set(++id,callback);return id;});
  vi.stubGlobal('cancelAnimationFrame',(frame:number)=>callbacks.delete(frame));
  return {tick(){const scheduled=[...callbacks.values()];callbacks.clear();scheduled.forEach(callback=>callback(0));}};
}

it('paints a 240Hz pointer stream at the display rate, including duplicate edge-scroll notifications',()=>{
  const clock=frameClock();let position=0;const paints:number[]=[];
  const frame=timelineGestureFrame(()=>paints.push(position));
  for(let displayFrame=0;displayFrame<60;displayFrame++){
    for(let move=0;move<4;move++){position++;frame.request();}
    frame.request();clock.tick();
  }
  expect(paints).toHaveLength(60);
  expect(paints.at(-1)).toBe(240);
});

it('flushes the latest release position before committing and cancels queued work on Escape/unmount',()=>{
  const clock=frameClock();let position=1;const paints:number[]=[];
  const frame=timelineGestureFrame(()=>paints.push(position));
  frame.request();position=2;frame.flush();clock.tick();
  expect(paints).toEqual([2]);
  frame.request();frame.cancel();clock.tick();
  expect(paints).toEqual([2]);
});
