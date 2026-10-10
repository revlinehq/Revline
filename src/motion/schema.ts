import { z } from "zod";
import { easingNames } from "./core/easing";
import { transitionTypes } from "./core/timeline";
export const cameraModes = ["static", "push-in", "pull-back", "pan-left", "pan-right", "focus"] as const;
export const revealModes = ["lines", "words", "fade"] as const;
export const layouts = ["editorial", "centered", "full-bleed"] as const;
const pose = { x: z.number().min(-1).max(2), y: z.number().min(-1).max(2), scale: z.number().min(.01).max(5), rotation: z.number().min(-360).max(360), opacity: z.number().min(0).max(1), blur: z.number().min(0).max(24) };
export const layerSchema = z.object({
  id: z.string().min(1).max(80), type: z.enum(["text", "rect", "ellipse", "image"]),
  text: z.string().max(140), assetId: z.string().max(80).nullable(),
  width: z.number().min(.02).max(1), height: z.number().min(.02).max(1),
  fontSize: z.number().min(.01).max(.2), color: z.string().regex(/^(ink|muted|accent|surface|#[0-9a-fA-F]{6})$/),
  align: z.enum(["left", "center"]),
  keyframes: z.array(z.object({ at: z.number().min(0).max(1), easing: z.enum(easingNames), ...pose })).min(2).max(8),
});
export const designSchema = z.object({
  background: z.enum(["plain", "grid", "orbit"]), backgroundAssetId: z.string().max(80).nullable(),
  layout: z.enum(layouts), reveal: z.enum(revealModes), easing: z.enum(easingNames),
  stagger: z.number().min(0).max(.3), motionBlur: z.boolean(),
  camera: z.object({ mode: z.enum(cameraModes), strength: z.number().min(0).max(1), focusX: z.number().min(0).max(1), focusY: z.number().min(0).max(1) }),
  transition: z.object({ type: z.enum(transitionTypes), duration: z.number().min(0).max(1.2) }),
  layers: z.array(layerSchema).max(6),
});
export type SceneDesign = z.infer<typeof designSchema>;
export type MotionLayerData = z.infer<typeof layerSchema>;
export function defaultDesign(type = "title"): SceneDesign {
  return { background: type === "title" ? "orbit" : "plain", backgroundAssetId: null, layout: type === "logo" || type === "outro" ? "centered" : type === "screenshot" ? "full-bleed" : "editorial", reveal: "lines", easing: "cinematic", stagger: .08, motionBlur: true,
    camera: { mode: type === "feature" || type === "composer" ? "focus" : type === "screenshot" ? "push-in" : "static", strength: type === "feature" ? .65 : .25, focusX: .65, focusY: .55 },
    transition: { type: type === "screenshot" ? "push" : type === "feature" ? "zoom" : type === "outro" ? "wipe" : "dissolve", duration: .6 }, layers: [] };
}
export function textLayer(text = "Your caption", id = crypto.randomUUID()): MotionLayerData {
  const hold = { x: .08, y: .83, scale: 1, rotation: 0, opacity: 1, blur: 0 };
  return { id, type: "text", text, assetId: null, width: .7, height: .12, fontSize: .032, color: "ink", align: "left", keyframes: [
    { ...hold, at: 0, y: .91, opacity: 0, blur: 8, easing: "ease-out" },
    { ...hold, at: .22, easing: "cinematic" }, { ...hold, at: .8, easing: "linear" },
    { ...hold, at: 1, y: .8, opacity: 0, easing: "cinematic" },
  ] };
}
