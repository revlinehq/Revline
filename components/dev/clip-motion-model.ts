import { Easing, interpolate, spring } from 'remotion';

export const CLIP_MOTION_PRESETS = [
  { id: 'none', label: 'None' }, { id: 'fade', label: 'Fade' },
  { id: 'slide-up', label: 'Slide up' }, { id: 'slide-down', label: 'Slide down' },
  { id: 'slide-left', label: 'Slide left' }, { id: 'slide-right', label: 'Slide right' },
  { id: 'pop', label: 'Pop' },
] as const;
export type ClipMotionPreset = typeof CLIP_MOTION_PRESETS[number]['id'];
export type ClipMotionEasing = 'linear' | 'ease-out' | 'ease-in-out' | 'spring';
export type ClipMotionPoint = 'start' | 'arrive' | 'leave' | 'end';
export type ClipMotionPose = { x: number; y: number; scale: number; rotation: number; opacity: number };
type ClipMotionAnchors = Record<ClipMotionPoint, number>;
export type ClipMotionLayer = {
  id: 'photo-1' | 'photo-2'; name: string; enabled: boolean;
  entrance: ClipMotionPreset; exit: ClipMotionPreset;
  start: number; end: number; enterDuration: number; exitDuration: number;
  distance: number; easing: ClipMotionEasing;
  x: number; y: number; width: number; aspect: 'landscape' | 'square' | 'portrait';
  rotation: number; radius: number;
  poses?: { start?: Partial<ClipMotionPose>; hold?: Partial<ClipMotionPose>; end?: Partial<ClipMotionPose> };
};
export const DEFAULT_CLIP_MOTION_LAYERS: readonly ClipMotionLayer[] = [
  { id: 'photo-1', name: 'Photo 1', enabled: true, entrance: 'fade', exit: 'fade', start: .25, end: 6.8, enterDuration: .7, exitDuration: .55, distance: 90, easing: 'ease-out', x: .35, y: .47, width: .4, aspect: 'landscape', rotation: -4, radius: 8 },
  { id: 'photo-2', name: 'Photo 2', enabled: true, entrance: 'slide-up', exit: 'slide-right', start: 1.2, end: 7.5, enterDuration: .75, exitDuration: .6, distance: 110, easing: 'ease-out', x: .65, y: .57, width: .36, aspect: 'portrait', rotation: 5, radius: 8 },
];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** Durations retain their seconds representation; all editable anchors resolve to whole frames. */
export function clipMotionAnchors(layer: ClipMotionLayer, fps: number): ClipMotionAnchors {
  const start = Math.max(0, Math.round(layer.start * fps)), end = Math.max(start + 2, Math.round(layer.end * fps));
  const entrance = clamp(Math.round(layer.enterDuration * fps), 1, end - start - 1);
  const exit = clamp(Math.round(layer.exitDuration * fps), 1, end - start - entrance);
  return { start, arrive: start + entrance, leave: end - exit, end };
}
function withAnchors(layer: ClipMotionLayer, anchors: ClipMotionAnchors, fps: number): ClipMotionLayer {
  return { ...layer, start: anchors.start / fps, end: anchors.end / fps, enterDuration: (anchors.arrive - anchors.start) / fps, exitDuration: (anchors.end - anchors.leave) / fps };
}
/** Preserve entrance/exit durations when possible, with no half-span restriction. */
export function boundClipMotionLayer(layer: ClipMotionLayer, duration: number, fps = 30): ClipMotionLayer {
  const total = Math.max(2, Math.round(duration * fps)), start = clamp(Math.round(layer.start * fps), 0, total - 2), end = clamp(Math.round(layer.end * fps), start + 2, total);
  return withAnchors(layer, clipMotionAnchors({ ...layer, start: start / fps, end: end / fps }, fps), fps);
}
/** A dragged anchor cannot push its neighbors; a zero-duration hold is valid. */
export function moveClipMotionAnchor(layer: ClipMotionLayer, point: ClipMotionPoint, targetFrame: number, duration: number, fps: number): ClipMotionLayer {
  const bounded = boundClipMotionLayer(layer, duration, fps), anchors = clipMotionAnchors(bounded, fps);
  const limits = { start: [0, anchors.arrive - 1], arrive: [anchors.start + 1, anchors.leave], leave: [anchors.arrive, anchors.end - 1], end: [anchors.leave + 1, Math.max(2, Math.round(duration * fps))] };
  const [min, max] = limits[point];
  return withAnchors(bounded, { ...anchors, [point]: clamp(Math.round(targetFrame), min, max) }, fps);
}
function progress(frame: number, start: number, end: number, fps: number, easing: ClipMotionEasing) {
  const elapsed = frame - start, frames = Math.max(1, end - start);
  if (elapsed <= 0) return 0;
  if (elapsed >= frames) return 1;
  if (easing === 'spring') return spring({ frame: elapsed, fps, durationInFrames: frames, config: { damping: 14, stiffness: 150, mass: 1 } });
  return interpolate(elapsed, [0, frames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easing === 'ease-out' ? Easing.out(Easing.cubic) : easing === 'ease-in-out' ? Easing.inOut(Easing.cubic) : Easing.linear });
}
function direction(preset: ClipMotionPreset) {
  return preset === 'slide-up' ? [0, -1] : preset === 'slide-down' ? [0, 1] : preset === 'slide-left' ? [-1, 0] : preset === 'slide-right' ? [1, 0] : [0, 0];
}
export function clipMotionPoseAtPoint(layer: ClipMotionLayer, point: ClipMotionPoint, width: number, height: number): ClipMotionPose {
  const hold: ClipMotionPose = { x: layer.x, y: layer.y, scale: 1, rotation: layer.rotation, opacity: 1, ...layer.poses?.hold };
  if (point === 'arrive' || point === 'leave') return hold;
  const preset = point === 'start' ? layer.entrance : layer.exit, vector = direction(preset), sign = point === 'start' ? -1 : 1;
  const pose: ClipMotionPose = { ...hold, x: hold.x + sign * vector[0] * layer.distance / width, y: hold.y + sign * vector[1] * layer.distance / height, scale: hold.scale * (preset === 'pop' ? .72 : 1), opacity: preset === 'none' ? hold.opacity : 0 };
  return { ...pose, ...layer.poses?.[point] };
}
/** Editing Arrive or Leave changes the same hold pose; untouched preset defaults stay derived. */
export function updateClipMotionPose(layer: ClipMotionLayer, point: ClipMotionPoint, patch: Partial<ClipMotionPose>, width: number, height: number): ClipMotionLayer {
  const key = point === 'arrive' || point === 'leave' ? 'hold' : point;
  const current = clipMotionPoseAtPoint(layer, point, width, height);
  const changed = Object.fromEntries(Object.entries(patch).map(([field, value]) => [field, value ?? current[field as keyof ClipMotionPose]]));
  return { ...layer, poses: { ...layer.poses, [key]: { ...layer.poses?.[key], ...changed } } };
}
/** All rendered geometry is an absolute normalized pose; the frame is the only animation clock. */
export function clipMotionAt(layer: ClipMotionLayer, frame: number, fps: number, width = 960, height = 540) {
  const anchors = clipMotionAnchors(layer, fps), visible = layer.enabled && frame >= anchors.start && frame < anchors.end;
  const phase = frame < anchors.arrive ? 'enter' : frame <= anchors.leave ? 'hold' : 'exit';
  const start = clipMotionPoseAtPoint(layer, 'start', width, height), hold = clipMotionPoseAtPoint(layer, 'arrive', width, height), end = clipMotionPoseAtPoint(layer, 'end', width, height);
  const from = phase === 'enter' ? start : hold, to = phase === 'enter' ? hold : phase === 'hold' ? hold : end;
  const amount = phase === 'enter' ? progress(frame, anchors.start, anchors.arrive, fps, layer.easing) : phase === 'exit' ? progress(frame, anchors.leave, anchors.end, fps, layer.easing) : 1;
  const mix = (key: keyof ClipMotionPose) => amount === 0 ? from[key] : amount === 1 ? to[key] : from[key] + (to[key] - from[key]) * amount;
  return { visible, x: mix('x'), y: mix('y'), rotation: mix('rotation'), scale: Math.max(.001, mix('scale')), opacity: visible ? clamp(mix('opacity'), 0, 1) : 0, phase: visible ? phase : 'hidden' };
}
