// The whip's motion, frame by frame: the one source of truth for the film whip() and the footage whip-pan.
// Pure: given the whip and a time relative to the cut, it returns where each shot sits and how much blur
// runs along the whip. The outgoing shot accelerates out (power4.in) and peaks on the frame before the cut;
// the incoming one starts at its peak on the cut, already moving the same way, and settles (expo.out).
import { WHIP_SHAPE, type WhipDirection } from './types';

/** One whip frame: a 30 fps frame on the timeline's own frame grid (1/30 s at 30 and 60 fps, 1/24 s at 24). */
export function whipFrameLength(fps: number) { return Math.max(1, Math.round(fps / 30)) / fps; }
export type WhipParams = { direction: WhipDirection; /** Frames in motion, counted at 30 fps. */ frames: number; /** The timeline's frame rate. */ fps: number; /** Share of the frame (0.15 = 15%). */ travel: number; /** Peak blur in px at 1080p; unset uses the default for the direction. */ blur?: number };
/** Where a shot sits: x and y as shares of the frame's width and height, and its scale around the frame's center. */
export type WhipPlacement = { x: number; y: number; scale: number };
export type WhipFrame = {
  /** The shot drawn on top; the other one sits underneath, filling the edge the front one uncovers. */
  front: 'out' | 'in';
  out: WhipPlacement; in: WhipPlacement;
  /** Blur in px at 1080p along each axis (the whip axis only; both axes for zooms). */
  blur: { x: number; y: number };
};

const power4In = (t: number) => t ** 4, expoRemaining = (t: number) => t >= 1 ? 0 : 2 ** (-10 * t);
const rest: WhipPlacement = { x: 0, y: 0, scale: 1 };
const tolerance = 1e-6;
// Float noise (an offset of -0.1499999 at the cut) would put a shot a hair off the pixel grid and resample the
// whole picture, so films and footage both get values rounded the same way.
const round = (value: number, step = 1e-6) => Math.round(value / step) * step;

/** The whip's frames around the cut: the outgoing half (rounded down) moves on the frames before it, the incoming
 * half from it. `before` is the seconds from the first frame in motion to the cut; `after` from the cut to the
 * first frame at rest again. A footage whip of `frames` frames spans exactly before + after around its cut. */
export function whipSpan(frames: number, fps: number) {
  const f = whipFrameLength(fps), outFrames = Math.floor(frames / 2), inFrames = frames - outFrames;
  return { f, outFrames, inFrames, before: outFrames * f, after: inFrames * f };
}
export function whipPeakBlur(params: WhipParams) {
  return params.blur ?? (params.direction === 'zoom' || params.direction === 'zoom-out' ? WHIP_SHAPE.blur.zoom : WHIP_SHAPE.blur.slide);
}

/** The whip at `t` seconds from the cut (negative before it). Outside the whip both shots are at rest. */
export function whipFrame(params: WhipParams, t: number): WhipFrame {
  const { direction, travel } = params, { f, outFrames, inFrames, before, after } = whipSpan(params.frames, params.fps);
  const front = t < -tolerance ? 'out' : 'in';
  if (t < -before - tolerance || t >= after - tolerance) return { front, out: rest, in: rest, blur: { x: 0, y: 0 } };
  // Outgoing: moving from its first frame (1/outFrames of the way, power4.in) to the peak on the frame before the
  // cut, held at the peak after it.
  const out = t >= -f - tolerance ? 1 : power4In(Math.min(1, Math.max(0, (t / f + outFrames + 1) / outFrames)));
  // Incoming: at its peak until the cut, then settling, at rest on the frame after its last.
  const incoming = t < -tolerance ? 1 : expoRemaining(t / (inFrames * f));
  const zoom = direction === 'zoom' || direction === 'zoom-out', horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'left' || direction === 'up' ? -1 : 1;
  const place = (offset: number, scale: number): WhipPlacement => zoom ? { x: 0, y: 0, scale: round(scale) } : { x: horizontal ? round(offset) : 0, y: horizontal ? 0 : round(offset), scale: 1 };
  const shape = direction === 'zoom' ? WHIP_SHAPE.zoomIn : WHIP_SHAPE.zoomOut;
  // A zoom-out leaves a border around the front shot; the shot underneath fills it at full size.
  const underneath = direction === 'zoom-out';
  const outPlace = place(sign * travel * out, front === 'in' && underneath ? 1 : 1 + travel * shape.out * out);
  const inPlace = place(-sign * travel * incoming, front === 'out' && underneath ? 1 : 1 + travel * shape.in * incoming);
  const size = round(whipPeakBlur(params) * (front === 'out' ? out : incoming), .01);
  return { front, out: outPlace, in: inPlace, blur: { x: zoom || horizontal ? size : 0, y: zoom || !horizontal ? size : 0 } };
}
