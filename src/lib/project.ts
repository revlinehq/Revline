import { z } from "zod";

export const sceneTypes = ["title", "logo", "screenshot", "feature", "cards", "chart", "workflow", "outro"] as const;
export const sceneLabels: Record<SceneType, string> = { title: "Typography", logo: "Logo reveal", screenshot: "Product showcase", feature: "Feature spotlight", cards: "Feature cards", chart: "Animated chart", workflow: "Workflow", outro: "Closing frame" };
export const sceneSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.enum(sceneTypes),
  title: z.string().max(100),
  subtitle: z.string().max(200),
  kicker: z.string().max(40),
  duration: z.number().min(1).max(12),
  motion: z.enum(["smooth", "spring", "snappy"]),
  assetId: z.string().max(80).nullable(),
  items: z.array(z.object({ label: z.string().max(50), detail: z.string().max(100), value: z.number().min(0).max(100) })).min(1).max(4),
});
export const projectSchema = z.object({
  name: z.string().min(1).max(80),
  theme: z.enum(["studio", "paper", "electric"]),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  aspect: z.enum(["landscape", "portrait", "square"]),
  scenes: z.array(sceneSchema).min(1).max(12),
});
export const assetSchema = z.object({
  id: z.string().min(1).max(80), name: z.string().max(120), role: z.enum(["screenshot", "logo"]),
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
  return { id, type, title: { title: "An idea worth showing.", logo: "Your brand. In motion.", screenshot: "Meet your new workspace.", feature: "Small details. Big difference.", cards: "Everything you need.", chart: "Make progress visible.", workflow: "From idea to impact.", outro: "Make your next move." }[type], subtitle: "Built for the way you work.", kicker: "THE NEXT CHAPTER", duration: 4, motion: "smooth", assetId: null,
    items: [{ label: "Create", detail: "Start with an idea", value: 38 }, { label: "Collaborate", detail: "Bring everyone together", value: 65 }, { label: "Launch", detail: "Make something great", value: 92 }] };
}
export const initialProject: Project = {
  name: "Introducing Orbit", theme: "studio", accent: "#f2f2f2", aspect: "landscape",
  scenes: [
    { ...createScene("title", "intro"), title: "Less busywork.\nMore possibility.", subtitle: "A calmer way to bring your best ideas to life.", kicker: "INTRODUCING ORBIT", duration: 3 },
    { ...createScene("screenshot", "product"), title: "Your work, in a new light.", subtitle: "One beautiful space for everything that matters.", kicker: "A FRESH PERSPECTIVE", duration: 5 },
    { ...createScene("feature", "spotlight"), title: "Find your flow.", subtitle: "From a little spark to your next big thing.", kicker: "BUILT AROUND YOU", duration: 4 },
    { ...createScene("cards", "features"), title: "Room for your best work.", subtitle: "Three simple steps. Endless possibilities.", kicker: "GO FURTHER", duration: 4 },
    { ...createScene("outro", "closing"), title: "Good things\nstart here.", subtitle: "Try Orbit today →", kicker: "YOUR NEXT CHAPTER", duration: 3 },
  ],
};
export function assertProject(project: unknown): Project {
  const parsed = projectSchema.parse(project);
  if (new Set(parsed.scenes.map(s => s.id)).size !== parsed.scenes.length) throw new Error("Every scene needs a unique ID");
  if (durationFrames(parsed) > 120 * FPS) throw new Error("Keep your video under 120 seconds");
  return parsed;
}
