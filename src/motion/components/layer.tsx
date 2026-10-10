import { type CSSProperties, type ReactNode } from "react";
import { clamp } from "../core/easing";
import { poseAt, type Pose, type PoseKeyframe } from "../core/keyframes";

export function Layer({ frame, duration, keyframes, width, height, children, motionBlur = false, origin = [0, 0] }: {
  frame: number; duration: number; keyframes: readonly PoseKeyframe[]; width: number; height: number;
  children: ReactNode; motionBlur?: boolean; origin?: [number, number];
}) {
  const pose = poseAt(keyframes, frame, duration);
  const previous = poseAt(keyframes, frame - .5, duration);
  const speed = Math.hypot((pose.x - previous.x) * width, (pose.y - previous.y) * height);
  const blur = pose.blur + (motionBlur ? Math.min(2.5, speed * .07) : 0);
  return <g transform={`translate(${pose.x * width} ${pose.y * height}) translate(${origin[0]} ${origin[1]}) rotate(${pose.rotation}) scale(${pose.scale}) translate(${-origin[0]} ${-origin[1]})`} opacity={clamp(pose.opacity)} style={{ filter: blur > .1 ? `blur(${blur}px)` : undefined }}>{children}</g>;
}
export const identity: Pose = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, blur: 0 };
export function entranceKeys(delay: number, end: number, distance = .07, easing: PoseKeyframe["easing"] = "cinematic"): PoseKeyframe[] {
  return [{ ...identity, at: Math.max(0, delay), y: distance, opacity: 0, blur: 3, easing }, { ...identity, at: Math.max(delay + .001, Math.min(1, end)), easing }];
}
export function transitionStyle(pose: { x: number; scale: number; opacity: number; insetRight: number }): CSSProperties {
  return { transform: `translateX(${pose.x}px) scale(${pose.scale})`, opacity: pose.opacity, clipPath: pose.insetRight ? `inset(0 ${pose.insetRight}% 0 0)` : undefined, transformOrigin: "center" };
}
