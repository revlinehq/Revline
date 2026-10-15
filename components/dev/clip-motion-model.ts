import { Easing, interpolate, spring } from 'remotion';

export const CLIP_MOTION_PRESETS = [
  { id: 'none', label: 'None' }, { id: 'fade', label: 'Fade' },
  { id: 'slide-up', label: 'Slide up' }, { id: 'slide-down', label: 'Slide down' },
  { id: 'slide-left', label: 'Slide left' }, { id: 'slide-right', label: 'Slide right' },
  { id: 'pop', label: 'Pop' },
] as const;
export type ClipMotionPreset = typeof CLIP_MOTION_PRESETS[number]['id'];
export type ClipMotionEasing = 'linear' | 'ease-out' | 'ease-in-out' | 'spring';
export type ClipMotionLayer = {
  id: 'photo-1' | 'photo-2'; name: string; enabled: boolean;
  entrance: ClipMotionPreset; exit: ClipMotionPreset;
  start: number; end: number; enterDuration: number; exitDuration: number;
  distance: number; easing: ClipMotionEasing;
  x: number; y: number; width: number; aspect: 'landscape' | 'square' | 'portrait';
  rotation: number; radius: number;
};
export const DEFAULT_CLIP_MOTION_LAYERS: readonly ClipMotionLayer[] = [
  { id: 'photo-1', name: 'Photo 1', enabled: true, entrance: 'fade', exit: 'fade', start: .25, end: 6.8, enterDuration: .7, exitDuration: .55, distance: 90, easing: 'ease-out', x: .35, y: .47, width: .4, aspect: 'landscape', rotation: -4, radius: 8 },
  { id: 'photo-2', name: 'Photo 2', enabled: true, entrance: 'slide-up', exit: 'slide-right', start: 1.2, end: 7.5, enterDuration: .75, exitDuration: .6, distance: 110, easing: 'ease-out', x: .65, y: .57, width: .36, aspect: 'portrait', rotation: 5, radius: 8 },
];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** Keep entrances and exits disjoint, including after a shorter preview duration is chosen. */
export function boundClipMotionLayer(layer: ClipMotionLayer, duration: number): ClipMotionLayer {
  const start = clamp(layer.start, 0, duration - .2), end = clamp(layer.end, start + .2, duration);
  const available = end - start;
  const enterDuration = clamp(layer.enterDuration, .05, available / 2), exitDuration = clamp(layer.exitDuration, .05, available / 2);
  return { ...layer, start, end, enterDuration, exitDuration };
}
function progress(frame: number, start: number, seconds: number, fps: number, easing: ClipMotionEasing) {
  const elapsed = frame - Math.round(start * fps), frames = Math.max(1, Math.round(seconds * fps));
  if (elapsed <= 0) return 0;
  if (elapsed >= frames) return 1;
  if (easing === 'spring') return spring({ frame: elapsed, fps, durationInFrames: frames, config: { damping: 14, stiffness: 150, mass: 1 } });
  return interpolate(elapsed, [0, frames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easing === 'ease-out' ? Easing.out(Easing.cubic) : easing === 'ease-in-out' ? Easing.inOut(Easing.cubic) : Easing.linear });
}
function direction(preset: ClipMotionPreset) {
  return preset === 'slide-up' ? [0, -1] : preset === 'slide-down' ? [0, 1] : preset === 'slide-left' ? [-1, 0] : preset === 'slide-right' ? [1, 0] : [0, 0];
}
/** Pure frame state: entrance direction describes travel into place; exit describes travel out. */
export function clipMotionAt(layer: ClipMotionLayer, frame: number, fps: number) {
  const time = frame / fps, visible = layer.enabled && frame >= Math.round(layer.start * fps) && frame < Math.round(layer.end * fps);
  const entrance = layer.entrance === 'none' ? 1 : progress(frame, layer.start, layer.enterDuration, fps, layer.easing);
  const exit = layer.exit === 'none' ? 0 : progress(frame, layer.end - layer.exitDuration, layer.exitDuration, fps, layer.easing);
  const incoming = direction(layer.entrance), outgoing = direction(layer.exit);
  const x = (-incoming[0] * (1 - entrance) + outgoing[0] * exit) * layer.distance;
  const y = (-incoming[1] * (1 - entrance) + outgoing[1] * exit) * layer.distance;
  const scale = (layer.entrance === 'pop' ? .72 + .28 * entrance : 1) * (layer.exit === 'pop' ? 1 - .28 * clamp(exit, 0, 1) : 1);
  const opacity = visible ? (layer.entrance === 'none' ? 1 : clamp(entrance, 0, 1)) * (layer.exit === 'none' ? 1 : 1 - clamp(exit, 0, 1)) : 0;
  return { visible, x, y, scale, opacity, phase: !visible ? 'hidden' : time < layer.start + layer.enterDuration && layer.entrance !== 'none' ? 'enter' : time >= layer.end - layer.exitDuration && layer.exit !== 'none' ? 'exit' : 'hold' };
}
