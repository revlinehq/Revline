import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createScene, initialProject, sceneTypes, type Project } from "../src/lib/project";
async function main() {
const base = process.env.VERIFY_BASE_URL || "http://127.0.0.1:3000";
const showcase = process.env.VERIFY_SHOWCASE === "1";
const project: Project = { ...(showcase ? initialProject : { name: "Motion library verification", soundtrack: "silent", theme: "studio", accent: "#f2f2f2", scenes: sceneTypes.map((type, i) => ({ ...createScene(type, `verify-${i}`), duration: 1 })) }), aspect: (process.env.VERIFY_ASPECT || "landscape") as Project["aspect"] };
const response = await fetch(`${base}/api/render`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project, assets: [], resolution: process.env.VERIFY_RESOLUTION || "720p" }) });
assert.equal(response.status, 200, await (response.status !== 200 ? response.text() : Promise.resolve("")));
assert.ok(response.body); const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = ""; let completed = false; let lastProgress = -1;
for (;;) {
  const { done, value } = await reader.read(); if (done) break; pending += decoder.decode(value, { stream: true }); const lines = pending.split("\n"); pending = lines.pop() || "";
  for (const line of lines) {
    const event = JSON.parse(line);
    if (event.type === "error") throw new Error(event.message);
    if (event.type === "progress" && event.progress >= lastProgress + 10) { console.log(`${event.stage}: ${event.progress}%`); lastProgress = event.progress; }
    if (event.type === "complete") { const bytes = Buffer.from(event.video, "base64"); assert.equal(bytes.toString("ascii", 4, 8), "ftyp"); assert.ok(bytes.length > 20_000); const output = `test-results/${showcase ? "composer-demo" : "all-scenes"}-${project.aspect}.mp4`; await mkdir("test-results", { recursive: true }); await writeFile(output, bytes); console.log(`Verified MP4: ${bytes.length} bytes, ${output}`); completed = true; }
  }
}
assert.ok(completed, "Render did not complete");

}
main().catch(error => { console.error(error); process.exitCode = 1; });
