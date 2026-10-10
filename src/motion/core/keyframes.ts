import { ease, mix, type Ease } from "./easing";
export type Keyframe = { frame: number; value: number; easing?: Ease };
export type Track = readonly Keyframe[];

/** A pure frame evaluator: seeking backwards produces the same result as rendering forwards. */
export function keyframe(track: Track, frame: number): number {
  if (!track.length) throw new Error("A motion track needs at least one keyframe");
  if (frame <= track[0].frame) return track[0].value;
  for (let i = 1; i < track.length; i++) {
    const previous = track[i - 1]; const next = track[i];
    if (next.frame <= previous.frame) throw new Error("Keyframe times must increase");
    if (frame <= next.frame) return mix(previous.value, next.value, ease((frame - previous.frame) / (next.frame - previous.frame), next.easing));
  }
  return track[track.length - 1].value;
}
export type Pose = { x: number; y: number; scale: number; rotation: number; opacity: number; blur: number };
export type PoseKeyframe = Pose & { at: number; easing: Ease };
export function poseAt(keys: readonly PoseKeyframe[], frame: number, duration: number): Pose {
  const property = (name: keyof Pose) => keyframe(keys.map(k => ({ frame: k.at * Math.max(1, duration - 1), value: k[name], easing: k.easing })), frame);
  return { x: property("x"), y: property("y"), scale: property("scale"), rotation: property("rotation"), opacity: property("opacity"), blur: property("blur") };
}
