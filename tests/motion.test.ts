import test from "node:test";
import assert from "node:assert/strict";
import { cubicBezier, ease } from "../src/motion/core/easing";
import { keyframe, poseAt } from "../src/motion/core/keyframes";
import { buildTimeline, transitionPose } from "../src/motion/core/timeline";
import { defaultDesign, textLayer } from "../src/motion/schema";
import { cameraPose } from "../src/motion/components/camera";
import { assertProject, createScene, durationFrames, initialProject, missingAsset } from "../src/lib/project";
import { demoEdit } from "../src/lib/demo-engine";

test("Bézier easing solves the time axis and clamps exact endpoints", () => {
  const linear = cubicBezier(.25,.25,.75,.75);
  assert.ok(Math.abs(linear(.37) - .37) < .0001);
  assert.equal(ease(-2),0); assert.equal(ease(2),1);
  assert.ok(ease(.2) < .2); assert.ok(ease(.8) > .8);
});
test("keyframe tracks support holds, multiple segments, and seeking in any order", () => {
  const track = [{ frame: 0,value: 0 },{ frame: 30,value: 100,easing: "linear" as const },{ frame: 60,value: 100 },{ frame: 90,value: 0,easing: "linear" as const }];
  assert.equal(keyframe(track,-10),0); assert.equal(keyframe(track,15),50); assert.equal(keyframe(track,45),100); assert.equal(keyframe(track,75),50); assert.equal(keyframe(track,200),0);
  assert.equal(keyframe(track,15),50);
  const layer = textLayer("Independent caption","test-layer");
  assert.equal(poseAt(layer.keyframes,99,100).opacity,0);
  assert.equal(poseAt(layer.keyframes,50,100).opacity,1);
});
test("incoming transitions keep scene start times and total duration stable", () => {
  const scenes = [createScene("title","a"),createScene("composer","b"),createScene("result","c")];
  const timing = buildTimeline(scenes,30);
  assert.deepEqual(timing.map(t => t.start),[0,120,240]);
  assert.equal(timing[0].renderDuration,timing[0].duration + timing[1].enter);
  assert.equal(timing[2].start + timing[2].renderDuration,360);
  for (const type of ["push","wipe","zoom","dissolve"] as const) {
    const end = transitionPose(type,17,18,1280,true);
    assert.deepEqual(end,{ x: 0,scale: 1,opacity: 1,insetRight: 0 });
  }
  assert.equal(transitionPose("wipe",0,18,1280,true).insetRight,100);
});
test("a one-second shot caps overlap so transitions cannot consume it", () => {
  const timing = buildTimeline([createScene("title","a"),{ ...createScene("title","b"),duration: 1 }],30);
  assert.equal(timing[1].enter,10); assert.equal(timing[1].start,120);
});
test("camera focus produces a deterministic zoom toward the requested feature", () => {
  const camera = { mode: "focus" as const,strength: 1,focusX: .8,focusY: .7 };
  assert.deepEqual(cameraPose(camera,0,120,1280,720),{ scale: 1,x: -0,y: -0 });
  const end = cameraPose(camera,119,120,1280,720);
  assert.equal(end.scale,1.9); assert.ok(end.x < 0); assert.ok(end.y < 0);
});
test("legacy projects migrate while invalid layer clocks and assets are rejected", () => {
  const legacy = { ...initialProject,soundtrack: undefined,scenes: initialProject.scenes.map(s => ({ ...s,design: undefined })) };
  const migrated = assertProject(legacy);
  assert.equal(migrated.soundtrack,"silent"); assert.deepEqual(migrated.scenes[0].design,defaultDesign("title"));
  const project = structuredClone(initialProject); const layer = textLayer("Caption","caption");
  layer.keyframes[1].at = 0; project.scenes[0].design.layers = [layer];
  assert.throws(() => assertProject(project),/increase/);
  project.scenes[0].design.layers = [{ ...textLayer("Image","image"),type: "image",assetId: "unknown" }];
  assert.equal(missingAsset(project,[]),true);
  project.scenes[0].design.layers = []; project.scenes[0].design.backgroundAssetId = "background";
  assert.equal(missingAsset(project,[]),true); assert.equal(missingAsset(project,[{ id: "background" }]),false);
});
test("the demo engine directs the composer example and adds editable overlays", () => {
  const created = demoEdit("Create a 20-second cinematic composer demo for Nova",initialProject,"intro").project;
  assert.deepEqual(created.scenes.map(s => s.type),["title","composer","result","cards","outro"]);
  assert.equal(durationFrames(created),600); assert.ok(created.scenes[1].duration >= 5);
  const zoomed = demoEdit("Zoom closer in scene 2",created,created.scenes[0].id).project;
  assert.equal(zoomed.scenes[1].design.camera.strength,.8);
  const typed = demoEdit('Change the typed prompt in scene 2 to "Reveal my new app."',created,created.scenes[0].id).project;
  assert.equal(typed.scenes[1].subtitle,"Reveal my new app.");
  assert.equal(typed.scenes[1].title,created.scenes[1].title);
  const wiped = demoEdit("Use a wipe into the result",zoomed,zoomed.scenes[0].id).project;
  assert.equal(wiped.scenes[2].design.transition.type,"wipe");
  const layered = demoEdit('Add a text layer "Ready to show"',wiped,wiped.scenes[0].id).project;
  assert.equal(layered.scenes[0].design.layers[0].text,"Ready to show"); assertProject(layered);
});
