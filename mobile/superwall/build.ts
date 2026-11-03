import { writeFile } from "node:fs/promises";
import { buildSnapshot } from "superwall/build";
import { discoverProject } from "superwall/discover";

const project = discoverProject(process.cwd());
if (project.diagnostics.length) throw new Error(project.diagnostics.join("\n"));
const surface = project.surfaces.find(surface => surface.id === "revline-membership");
if (!surface) throw new Error("The membership surface is missing.");
const snapshot = await buildSnapshot(project, surface, { platform: "ios" });
await writeFile(new URL("./.superwall/push.json", import.meta.url), JSON.stringify({
  html: snapshot.html,
  surface: surface.id,
  products: Object.entries(snapshot.products).map(([reference_name, identifier]) => ({ store: "app-store", identifier, reference_name })),
  locales: ["en-US"],
  ...snapshot.settings,
}));
console.log(`Built membership snapshot (${snapshot.bytes} bytes). Nothing published.`);
