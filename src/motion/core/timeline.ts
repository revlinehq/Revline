import { progress } from "./easing";
export const transitionTypes = ["cut", "dissolve", "wipe", "push", "zoom"] as const;
export type TransitionType = typeof transitionTypes[number];
export type Transition = { type: TransitionType; duration: number };
export type ShotTiming = { duration: number; design: { transition: Transition } };
export function transitionFrames(transition: Transition, incomingFrames: number, outgoingFrames: number, fps: number) {
  return transition.type === "cut" ? 0 : Math.max(0, Math.min(Math.round(transition.duration * fps), Math.floor(incomingFrames / 3), Math.floor(outgoingFrames / 3)));
}
/** Transitions overlap a held outgoing shot. Nominal scene starts and total duration stay stable. */
export function buildTimeline(scenes: readonly ShotTiming[], fps: number) {
  const lengths = scenes.map(s => Math.round(s.duration * fps));
  return scenes.map((scene, index) => {
    const start = lengths.slice(0, index).reduce((sum, n) => sum + n, 0);
    const enter = index ? transitionFrames(scene.design.transition, lengths[index], lengths[index - 1], fps) : 0;
    const exit = index < scenes.length - 1 ? transitionFrames(scenes[index + 1].design.transition, lengths[index + 1], lengths[index], fps) : 0;
    return { start, duration: lengths[index], enter, exit, renderDuration: lengths[index] + exit };
  });
}
export type TransitionPose = { x: number; scale: number; opacity: number; insetRight: number };
export function transitionPose(type: TransitionType, frame: number, frames: number, width: number, incoming: boolean): TransitionPose {
  const p = frames ? progress(frame, 0, Math.max(1, frames - 1)) : 1;
  const base = { x: 0, scale: 1, opacity: 1, insetRight: 0 };
  if (type === "push") return { ...base, x: incoming ? width * (1 - p) : -width * p };
  if (type === "wipe") return incoming ? { ...base, insetRight: 100 * (1 - p) } : base;
  if (type === "zoom") return { ...base, scale: incoming ? 1.12 - p * .12 : 1 + p * .08, opacity: incoming ? p : 1 };
  if (type === "dissolve") return { ...base, opacity: incoming ? p : 1 };
  return base;
}
