import { expect, test } from 'vitest';
import { boundClipMotionLayer, clipMotionAnchors, clipMotionAt, clipMotionPoseAtPoint, DEFAULT_CLIP_MOTION_LAYERS, moveClipMotionAnchor, updateClipMotionPose, type ClipMotionLayer, type ClipMotionPoint } from './clip-motion-model';

const layer: ClipMotionLayer = { ...DEFAULT_CLIP_MOTION_LAYERS[1], start: 1, end: 6, enterDuration: 2, exitDuration: 1, easing: 'linear' };
test('dragging one snapped anchor preserves the other absolute anchors, allows zero hold and removes the half-span cap', () => {
  const original = { start: 30, arrive: 90, leave: 150, end: 180 };
  expect(clipMotionAnchors(layer, 30)).toEqual(original);
  for (const point of ['start', 'arrive', 'leave', 'end'] as ClipMotionPoint[]) for (const target of [-100, 109.6, 999]) {
    const moved = clipMotionAnchors(moveClipMotionAnchor(layer, point, target, 8, 30), 30);
    for (const other of Object.keys(original) as ClipMotionPoint[]) if (other !== point) expect(moved[other]).toBe(original[other]);
    expect(moved.start).toBeLessThan(moved.arrive); expect(moved.arrive).toBeLessThanOrEqual(moved.leave); expect(moved.leave).toBeLessThan(moved.end); expect(moved.end).toBeLessThanOrEqual(240);
  }
  const longEntry = moveClipMotionAnchor(layer, 'arrive', 140, 8, 30);
  expect(longEntry.enterDuration).toBeCloseTo(110 / 30); expect(longEntry.enterDuration).toBeGreaterThan((longEntry.end - longEntry.start) / 2);
  expect(clipMotionAnchors(moveClipMotionAnchor(layer, 'arrive', 999, 8, 30), 30)).toEqual({ ...original, arrive: 150 });
  for (const fps of [24, 30, 60]) { const anchors = clipMotionAnchors(boundClipMotionLayer(layer, 2 / fps, fps), fps); expect(anchors).toEqual({ start: 0, arrive: 1, leave: 1, end: 2 }); }
});

test('preset-only photos derive normalized start and end poses from the same hold pose and actual canvas size', () => {
  const hold = clipMotionPoseAtPoint(layer, 'arrive', 960, 540);
  expect(clipMotionPoseAtPoint(layer, 'leave', 960, 540)).toEqual(hold);
  expect(clipMotionPoseAtPoint(layer, 'start', 960, 540)).toMatchObject({ x: hold.x, y: hold.y + layer.distance / 540, opacity: 0, rotation: layer.rotation });
  expect(clipMotionPoseAtPoint(layer, 'end', 960, 540)).toMatchObject({ x: hold.x + layer.distance / 960, y: hold.y, opacity: 0 });
  expect(clipMotionPoseAtPoint(layer, 'start', 540, 960).y).toBeCloseTo(hold.y + layer.distance / 960);
});

test('Arrive and Leave edit one hold pose while partial start/end overrides keep unedited preset defaults', () => {
  const hold = updateClipMotionPose(layer, 'leave', { x: .4, scale: 1.5, rotation: 20, opacity: .65 }, 960, 540);
  expect(clipMotionPoseAtPoint(hold, 'arrive', 960, 540)).toEqual(clipMotionPoseAtPoint(hold, 'leave', 960, 540));
  const customized = updateClipMotionPose(hold, 'start', { x: -.15, opacity: .2 }, 960, 540);
  const movedHold = updateClipMotionPose(customized, 'arrive', { y: .3, rotation: 45 }, 960, 540);
  expect(clipMotionPoseAtPoint(movedHold, 'start', 960, 540)).toMatchObject({ x: -.15, y: .3 + layer.distance / 540, scale: 1.5, rotation: 45, opacity: .2 });
  expect(layer.poses).toBeUndefined(); expect(customized.poses?.hold?.rotation).toBe(20);
});

test('frame rendering interpolates exact authored endpoints, holds steady, stays deterministic backward and honors disabled/exclusive end', () => {
  let authored = updateClipMotionPose(layer, 'start', { x: .1, y: .2, scale: .5, rotation: -10, opacity: .2 }, 960, 540);
  authored = updateClipMotionPose(authored, 'arrive', { x: .5, y: .6, scale: 1.5, rotation: 30, opacity: .8 }, 960, 540);
  authored = updateClipMotionPose(authored, 'end', { x: .9, y: .1, scale: .7, rotation: 80, opacity: .1 }, 960, 540);
  expect(clipMotionAt(authored, 30, 30)).toMatchObject({ x: .1, y: .2, scale: .5, rotation: -10, opacity: .2, visible: true, phase: 'enter' });
  expect(clipMotionAt(authored, 60, 30)).toMatchObject({ x: expect.closeTo(.3), y: expect.closeTo(.4), scale: 1, rotation: 10, opacity: .5 });
  for (const frame of [90, 120, 150]) expect(clipMotionAt(authored, frame, 30)).toMatchObject({ x: .5, y: .6, scale: 1.5, rotation: 30, opacity: .8, phase: 'hold' });
  const sample = clipMotionAt(authored, 165, 30); for (const frame of [179, 0, 140, 40]) clipMotionAt(authored, frame, 30); expect(clipMotionAt(authored, 165, 30)).toEqual(sample);
  expect(clipMotionAt(authored, 180, 30)).toMatchObject({ x: .9, y: .1, scale: .7, rotation: 80, opacity: 0, visible: false, phase: 'hidden' });
  expect(clipMotionAt({ ...authored, enabled: false }, 120, 30)).toMatchObject({ opacity: 0, visible: false });
});
