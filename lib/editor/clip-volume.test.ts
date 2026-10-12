import { expect, it } from 'vitest';
import { clipVolumeAtPointer } from './clip-volume';

it('keeps the grab value and raises or lowers volume without moving the clip',()=>{
  expect(clipVolumeAtPointer(.75,100,100,40)).toBe(.75);
  expect(clipVolumeAtPointer(.75,100,110,40)).toBe(.5);
  expect(clipVolumeAtPointer(.5,100,90,40)).toBe(.75);
});
it('reaches silence or full volume at the edges and never exceeds supported gain',()=>{
  expect(clipVolumeAtPointer(1,100,140,40)).toBe(0);
  expect(clipVolumeAtPointer(0,100,60,40)).toBe(1);
  expect(clipVolumeAtPointer(.5,100,1000,40)).toBe(0);
  expect(clipVolumeAtPointer(.5,100,-1000,40)).toBe(1);
});
