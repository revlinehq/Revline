import { describe, expect, it } from 'vitest';
import { isDoubleTimelineTap, timelineTimeAtPointer, type TimelineTap } from './timeline-controls';

const first:TimelineTap={clipId:'video',pointerType:'mouse',time:1000,x:240,y:180};

describe('clip click and tap seeking',()=>{
  it('keeps a single click as selection and recognizes a nearby second click on that clip',()=>{
    expect(isDoubleTimelineTap(null,first)).toBe(false);
    expect(isDoubleTimelineTap(first,{...first,time:1250,x:242})).toBe(true);
    const touch={...first,pointerType:'touch'};
    expect(isDoubleTimelineTap(touch,{...touch,time:1250,x:245,y:183})).toBe(true);
  });
  it('does not combine separate clips, input devices, slow clicks, or distant taps',()=>{
    expect(isDoubleTimelineTap(first,{...first,clipId:'caption',time:1250})).toBe(false);
    expect(isDoubleTimelineTap(first,{...first,pointerType:'touch',time:1250})).toBe(false);
    expect(isDoubleTimelineTap(first,{...first,time:1500})).toBe(false);
    expect(isDoubleTimelineTap(first,{...first,time:1250,x:260})).toBe(false);
  });
});

describe('seek position at the pointer',()=>{
  const viewport={left:200,scrollLeft:162,origin:0,px:54,end:15,fps:30};
  it('accounts for horizontal scrolling and zoom and lands on a video frame',()=>{
    expect(timelineTimeAtPointer(337,viewport)).toBeCloseTo(5.533333333333333);
    expect(timelineTimeAtPointer(337,{...viewport,px:108})).toBeCloseTo(2.7666666666666666);
    expect(timelineTimeAtPointer(347,{...viewport,origin:10})).toBeCloseTo(5.533333333333333);
  });
  it('clamps seeks to the media bounds and supports nearby edge snapping without moving clip data',()=>{
    expect(timelineTimeAtPointer(-100,viewport)).toBe(0);
    expect(timelineTimeAtPointer(2000,viewport)).toBe(15);
    expect(timelineTimeAtPointer(320,{...viewport,marks:[5.2]})).toBe(5.2);
    expect(timelineTimeAtPointer(320,viewport)).toBeCloseTo(5.233333333333333);
  });
});
