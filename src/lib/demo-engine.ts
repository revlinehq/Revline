import { createScene, Project, SceneType, sceneTypes } from "./project";

// An intentionally limited local engine for trying the editor without an API key.
export function demoEdit(prompt: string, current: Project, selectedId: string | null): { project: Project; message: string } {
  const project = structuredClone(current);
  const lower = prompt.toLowerCase();
  const specific = /(?:scene|shot)\s*(\d+)/i.exec(prompt);
  const index = specific ? Number(specific[1]) - 1 : project.scenes.findIndex(s => s.id === selectedId);
  const target = project.scenes[index >= 0 ? index : 0];
  if (specific && !project.scenes[index]) return { project, message: "That scene doesn’t exist. Select a scene from the timeline and try again." };
  const seconds = /(?:for|to|last|hold|duration|make|total)?\s*(\d+(?:\.\d+)?)\s*[- ]?\s*(?:seconds?|secs?|s\b)/i.exec(prompt);
  if (/\b(create|generate|build|make)\b/.test(lower) && /\b(demo|video|launch|intro)\b/.test(lower) && !/\b(scene|shot)\b/.test(lower)) {
    const brand = /(?:for|called|named|introducing)\s+["“]?([A-Za-z][\w -]{1,35}?)(?:["”.,]|\s+(?:with|in|using|that|a|an|and)|$)/i.exec(prompt)?.[1]?.trim() || "Your product";
    const types: SceneType[] = ["title", "screenshot", "feature", /chart|growth|data/.test(lower) ? "chart" : /workflow|steps/.test(lower) ? "workflow" : "cards", "outro"];
    const duration = Math.max(5, Math.min(60, Number(seconds?.[1] || 20))) / types.length;
    project.name = `Introducing ${brand}`;
    project.scenes = types.map((type, i) => ({ ...createScene(type), duration, kicker: i === 0 ? `INTRODUCING ${brand}`.slice(0, 40) : ["", "MEET YOUR WORKSPACE", "THE DETAILS MATTER", "MAKE IT HAPPEN", "START TODAY"][i], title: [ `Meet ${brand}.`, "Everything, in one place.", "Designed to keep you moving.", "Do more of what matters.", `Your next chapter.\n${brand}.` ][i], subtitle: i === 4 ? `Discover ${brand} →` : "A simpler way to turn your ideas into progress." }));
    const screenshotId = current.scenes.find(s => s.assetId)?.assetId;
    if (screenshotId) project.scenes[1].assetId = screenshotId;
    applyStyle(lower, project);
    return { project, message: `Built a ${Math.round(duration * 5)}-second, five-scene demo for ${brand}. This is the local demo engine; connect an AI model for open-ended creative direction.` };
  }
  if (/\b(add|insert)\b/.test(lower)) {
    const type = sceneTypes.find(t => lower.includes(t)) || (/typography|text/.test(lower) ? "title" : "feature");
    if (project.scenes.length >= 12) return { project, message: "This MVP supports up to 12 scenes. Remove a scene first." };
    project.scenes.splice(index >= 0 ? index + 1 : project.scenes.length, 0, createScene(type));
    return { project, message: `Added a ${type} scene. You can edit its copy and timing in the inspector.` };
  }
  if (/\b(remove|delete)\b/.test(lower) && /scene|shot/.test(lower)) {
    if (project.scenes.length === 1) return { project, message: "Keep at least one scene in the video." };
    project.scenes.splice(index >= 0 ? index : 0, 1);
    return { project, message: "Removed the scene. The remaining scenes keep their settings." };
  }
  let changed = false;
  if (seconds) {
    if (/whole|total|entire|video/.test(lower) && !specific) {
      const each = Math.max(1, Math.min(12, Number(seconds[1]) / project.scenes.length));
      project.scenes.forEach(s => { s.duration = each; });
    } else target.duration = Math.max(1, Math.min(12, Number(seconds[1])));
    changed = true;
  }
  const copy = /(?:title|headline|text|say|read)[^"“\n]{0,30}["“]([^"”]+)["”]/i.exec(prompt)?.[1];
  if (copy) { target.title = copy.slice(0, 100); changed = true; }
  if (/slower|longer/.test(lower) && !seconds) { target.duration = Math.min(12, target.duration + 1); changed = true; }
  if (/faster|shorter/.test(lower) && !seconds) { target.duration = Math.max(1, target.duration - 1); changed = true; }
  if (/spring|bouncy/.test(lower)) { target.motion = "spring"; changed = true; }
  if (/snappy|punchy/.test(lower)) { target.motion = "snappy"; changed = true; }
  if (/smooth|calm/.test(lower)) { target.motion = "smooth"; changed = true; }
  if (applyStyle(lower, project)) changed = true;
  if (/portrait|vertical|9:16/.test(lower)) { project.aspect = "portrait"; changed = true; }
  if (/square|1:1/.test(lower)) { project.aspect = "square"; changed = true; }
  if (/landscape|wide|16:9/.test(lower)) { project.aspect = "landscape"; changed = true; }
  return { project, message: changed ? "Updated your composition. Everything else stays as you left it. Use Undo to compare." : 'The local demo engine supports creating a video, adding scenes, timing, quoted headlines, colors, motion, and aspect ratios. Try “Make scene 2 last 6 seconds” or connect an AI model for free-form requests.' };
}
function applyStyle(prompt: string, project: Project) {
  let changed = false;
  for (const [word, theme] of [["paper", "paper"], ["light", "paper"], ["electric", "electric"], ["dark", "studio"], ["studio", "studio"]] as const) {
    if (new RegExp(`\\b${word}\\b`).test(prompt)) { project.theme = theme; changed = true; }
  }
  const hex = /#[0-9a-f]{6}\b/i.exec(prompt)?.[0];
  if (hex) { project.accent = hex; changed = true; }
  else for (const [word, color] of Object.entries({ purple: "#ae9bff", blue: "#80b7ff", orange: "#ffab70", green: "#c8f488", pink: "#ff9ccf", yellow: "#f5dc8a" })) if (prompt.includes(word)) { project.accent = color; changed = true; }
  return changed;
}
