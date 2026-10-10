import type { ReactNode } from "react";
import { mix, progress } from "../core/easing";
import type { SceneDesign } from "../schema";
export function cameraPose(camera: SceneDesign["camera"], frame: number, duration: number, width: number, height: number) {
  const p = progress(frame, duration * .12, duration * .76);
  const strength = camera.strength;
  let scale = 1; let x = 0; let y = 0;
  if (camera.mode === "push-in" || camera.mode === "focus") {
    scale = mix(1, 1 + strength * (camera.mode === "focus" ? .9 : .3), p);
    x = (width / 2 - camera.focusX * width) * (scale - 1);
    y = (height / 2 - camera.focusY * height) * (scale - 1);
  } else if (camera.mode === "pull-back") scale = mix(1 + strength * .4, 1, p);
  else if (camera.mode === "pan-left" || camera.mode === "pan-right") { scale = 1 + strength * .12; x = mix(-1, 1, p) * width * strength * .075 * (camera.mode === "pan-left" ? -1 : 1); }
  return { scale, x, y };
}
export function CameraRig({ camera, frame, duration, width, height, children }: { camera: SceneDesign["camera"]; frame: number; duration: number; width: number; height: number; children: ReactNode }) {
  const { scale, x, y } = cameraPose(camera, frame, duration, width, height);
  return <g transform={`translate(${width / 2 + x} ${height / 2 + y}) scale(${scale}) translate(${-width / 2} ${-height / 2})`}>{children}</g>;
}
