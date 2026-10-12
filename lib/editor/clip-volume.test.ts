import { expect, it } from 'vitest';
import { clipVolumeAtPointer, clipVolumeAtFraction, clipVolumeEnvelope } from './clip-volume';

it('keeps the grab value and raises or lowers volume without moving the clip',()=>{
  expect(clipVolumeAtPointer(.75,100,100,40)).toBe(.75);
  expect(clipVolumeAtPointer(.75,100,105,40)).toBe(.5);
  expect(clipVolumeAtPointer(.5,100,95,40)).toBe(.75);
});
it('reaches silence or boosted volume at the edges and never exceeds supported gain',()=>{
  expect(clipVolumeAtPointer(1,100,120,40)).toBe(0);
  expect(clipVolumeAtPointer(0,100,60,40)).toBe(2);
  expect(clipVolumeAtPointer(.5,100,1000,40)).toBe(0);
  expect(clipVolumeAtPointer(.5,100,-1000,40)).toBe(2);
});

it('places original audio at the center with room for attenuation and boost',()=>{
  expect(clipVolumeAtPointer(0,120,100,40)).toBe(1);
  expect(clipVolumeAtPointer(1,100,80,40)).toBe(2);
  expect(clipVolumeAtPointer(1,100,120,40)).toBe(0);
});

it('updates live HyperFrames gain above unity and back without stale cached volume',async()=>{
  const { elementVolumeLaneGain }=await import('../../node_modules/@hyperframes/core/dist/runtime/audioAutomationVolume.js');
  let envelope=clipVolumeEnvelope(1);
  const element={getAttribute:()=>envelope} as unknown as HTMLMediaElement;
  expect(elementVolumeLaneGain(element,.5)).toBe(1);
  envelope=clipVolumeEnvelope(2);expect(elementVolumeLaneGain(element,.5)).toBe(2);
  envelope=clipVolumeEnvelope(.5);expect(elementVolumeLaneGain(element,.5)).toBe(.5);
  envelope=clipVolumeEnvelope(0);expect(elementVolumeLaneGain(element,.5)).toBe(0);
});

it('makes unity easy to recover despite fractional slider pixels while preserving a grab value',()=>{
  expect(clipVolumeAtFraction(.507)).toBe(1);
  expect(clipVolumeAtFraction(.493)).toBe(1);
  expect(clipVolumeAtFraction(.52)).toBe(1.04);
  expect(clipVolumeAtPointer(1.01,100,100,40)).toBe(1.01);
});
