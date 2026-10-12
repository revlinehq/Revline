import { describe, expect, it } from 'vitest';
import { timelineTimeAtPointer } from './timeline-controls';

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
