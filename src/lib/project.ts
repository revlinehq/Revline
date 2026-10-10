import { z } from "zod";
import { defaultDesign, designSchema } from "../motion/schema";

export const sceneTypes = ["title", "logo", "screenshot", "feature", "cards", "chart", "workflow", "composer", "result", "outro"] as const;
export const sceneLabels: Record<SceneType, string> = { title: "Typography", logo: "Logo reveal", screenshot: "Product showcase", feature: "Feature spotlight", cards: "Feature cards", chart: "Animated chart", workflow: "Workflow", composer: "AI composer", result: "Result reveal", outro: "Closing frame" };
export const sceneSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.enum(sceneTypes),
  title: z.string().max(100),
  subtitle: z.string().max(200),
  kicker: z.string().max(40),
  duration: z.number().min(1).max(12),
  motion: z.enum(["smooth", "spring", "snappy"]),
  assetId: z.string().max(80).nullable(),
  design: designSchema,
  items: z.array(z.object({ label: z.string().max(50), detail: z.string().max(100), value: z.number().min(0).max(100) })).min(1).max(4),
});
export const projectSchema = z.object({
  name: z.string().min(1).max(80),
  theme: z.enum(["studio", "paper", "electric"]),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  aspect: z.enum(["landscape", "portrait", "square"]),
  soundtrack: z.enum(["silent", "ambient", "pulse"]),
  scenes: z.array(sceneSchema).min(1).max(12),
});
export const assetSchema = z.object({
  id: z.string().min(1).max(80), name: z.string().max(120), role: z.enum(["screenshot", "logo", "background"]),
  src: z.string().max(7_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/),
});
export const assetsSchema = z.array(assetSchema).max(8).refine(assets => assets.reduce((sum, asset) => sum + asset.src.length, 0) <= 20_000_000, "Total assets must be under 15 MB");
export type Scene = z.infer<typeof sceneSchema>;
export type SceneType = typeof sceneTypes[number];
export type Project = z.infer<typeof projectSchema>;
export type Asset = z.infer<typeof assetSchema>;
export const FPS = 30;
export function durationFrames(project: Project) { return project.scenes.reduce((total, scene) => total + Math.round(scene.duration * FPS), 0); }
export function sceneStart(project: Project, index: number) { return project.scenes.slice(0, index).reduce((total, scene) => total + Math.round(scene.duration * FPS), 0); }
export function dimensions(aspect: Project["aspect"], resolution: "720p" | "1080p" = "1080p") {
  const short = resolution === "720p" ? 720 : 1080;
  return aspect === "square" ? { width: short, height: short } : aspect === "portrait" ? { width: short, height: Math.round(short * 16 / 9) } : { width: Math.round(short * 16 / 9), height: short };
}
export function createScene(type: SceneType, id = crypto.randomUUID()): Scene {
  return { id, type, title: { title: "An idea worth showing.", logo: "Your brand. In motion.", screenshot: "Meet your new workspace.", feature: "Small details. Big difference.", cards: "Everything you need.", chart: "Make progress visible.", workflow: "From idea to impact.", composer: "Describe it. Direct it.", result: "Ready for your next demo.", outro: "Make your next move." }[type], subtitle: "Built for the way you work.", kicker: "THE NEXT CHAPTER", duration: 4, motion: "smooth", assetId: null, design: defaultDesign(type),
    items: [{ label: "Create", detail: "Start with an idea", value: 38 }, { label: "Collaborate", detail: "Bring everyone together", value: 65 }, { label: "Launch", detail: "Make something great", value: 92 }] };
}
export const initialProject: Project = {
  name: "Introducing Frame", theme: "studio", accent: "#f2f2f2", aspect: "landscape", soundtrack: "pulse",
  scenes: [
    { ...createScene("title", "intro"), title: "Introducing Frame.", subtitle: "For your next product demo.", kicker: "FROM A SENTENCE TO A FILM", duration: 3 },
    { ...createScene("composer", "product"), title: "Your idea. In motion.", subtitle: "Create a cinematic launch video for my app. Reveal the UI, zoom into the details, and end on the logo.", kicker: "01 / DESCRIBE IT", duration: 6 },
    { ...createScene("result", "spotlight"), title: "A film. From a prompt.", subtitle: "Preview. Refine. Make it yours.", kicker: "02 / THE RESULT", duration: 4 },
    { ...createScene("cards", "features"), title: "Under your direction.", subtitle: "Edit the story, the camera, the timing.", kicker: "03 / REFINE IT", duration: 3,
      items: [{ label: "Compose", detail: "Choose the story", value: 38 }, { label: "Direct", detail: "Shape every movement", value: 65 }, { label: "Export", detail: "Ready to show", value: 92 }] },
    { ...createScene("outro", "closing"), title: "Worth showing.", subtitle: "Made with Frame.", kicker: "YOUR NEXT DEMO", duration: 3 },
  ],
};
export function assertProject(project: unknown): Project {
  const raw = project as Partial<Project> | null;
  const parsed = projectSchema.parse(raw && { ...raw, soundtrack: raw.soundtrack || "silent", scenes: Array.isArray(raw.scenes) ? raw.scenes.map(s => ({ ...s, design: s.design || defaultDesign(s.type) })) : raw.scenes });
  if (new Set(parsed.scenes.map(s => s.id)).size !== parsed.scenes.length) throw new Error("Every scene needs a unique ID");
  if (durationFrames(parsed) > 120 * FPS) throw new Error("Keep your video under 120 seconds");
  for (const scene of parsed.scenes) {
    if (new Set(scene.design.layers.map(l => l.id)).size !== scene.design.layers.length) throw new Error("Every layer needs a unique ID");
    for (const layer of scene.design.layers) if (layer.keyframes.some((k, i) => i > 0 && k.at <= layer.keyframes[i - 1].at)) throw new Error("Layer keyframe times must increase");
  }
  return parsed;
}
export function missingAsset(project: Project, assets: { id: string }[]) {
  const ids = new Set(assets.map(a => a.id));
  return project.scenes.some(s => (s.design.backgroundAssetId && !ids.has(s.design.backgroundAssetId)) || (s.assetId && !ids.has(s.assetId)) || s.design.layers.some(l => l.type === "image" && (!l.assetId || !ids.has(l.assetId))));
}
