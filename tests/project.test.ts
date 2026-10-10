import test from "node:test";
import assert from "node:assert/strict";
import { assertProject, assetsSchema, createScene, dimensions, durationFrames, initialProject, sceneStart } from "../src/lib/project";
import { demoEdit } from "../src/lib/demo-engine";

test("a targeted timing edit preserves every other scene and project setting", () => {
  const result = demoEdit("Make scene 2 last 8 seconds", initialProject, "intro");
  assert.equal(result.project.scenes[1].duration, 8);
  for (const index of [0, 2, 3, 4]) assert.deepEqual(result.project.scenes[index], initialProject.scenes[index]);
  assert.equal(result.project.theme, initialProject.theme);
  assert.equal(initialProject.scenes[1].duration, 6);
});
test("creation honors brand, duration, aspect style, and produces valid scenes", () => {
  const { project } = demoEdit("Create a 20-second launch video for Nova with electric purple accents", initialProject, "intro");
  assert.equal(project.name, "Introducing Nova");
  assert.equal(durationFrames(project), 600);
  assert.equal(project.theme, "electric");
  assert.equal(project.accent, "#ae9bff");
  assert.equal(project.scenes.length, 5);
  assertProject(project);
});
test("out-of-range scene edits do not corrupt the composition", () => {
  assert.deepEqual(demoEdit("Make scene 90 last 8 seconds", initialProject, "intro").project, initialProject);
  assert.throws(() => assertProject({ ...initialProject, scenes: [initialProject.scenes[0], initialProject.scenes[0]] }), /unique/);
  assert.throws(() => assertProject({ ...initialProject, scenes: Array.from({ length: 12 }, (_, i) => ({ ...createScene("title", `scene-${i}`), duration: 12 })) }), /120/);
  assert.throws(() => assertProject({ ...initialProject, scenes: [{ ...initialProject.scenes[0], duration: 0 }] }));
});
test("all formats preserve duration and give correct output dimensions", () => {
  assert.deepEqual(dimensions("landscape"), { width: 1920, height: 1080 });
  assert.deepEqual(dimensions("portrait", "720p"), { width: 720, height: 1280 });
  assert.deepEqual(dimensions("square"), { width: 1080, height: 1080 });
  assert.equal(sceneStart(initialProject, 2), 270);
  assert.equal(durationFrames(initialProject), 570);
});
test("uploads reject URLs, executable SVG, and oversized payloads", () => {
  const asset = { id: "asset", name: "example.png", role: "screenshot", src: "data:image/png;base64,AAAA" };
  assetsSchema.parse([asset]);
  for (const src of ["https://example.com/image.png", "file:///etc/passwd", "data:image/svg+xml;base64,AAAA", "data:image/png;base64," + "A".repeat(7_000_000)]) assert.throws(() => assetsSchema.parse([{ ...asset, src }]));
});

test("hyphenated duration briefs are interpreted correctly", () => {
  const { project } = demoEdit("Create a 15-second launch video for Nova", initialProject, "intro");
  assert.equal(durationFrames(project), 450);
});
