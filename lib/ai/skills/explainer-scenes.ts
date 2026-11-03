import type { EditorSkill } from './index';

export const explainerScenes: EditorSkill = {
  name: 'explainer-scenes',
  description: 'Explainer visuals and overlays on footage: titles, diagrams, charts, UI walkthroughs, kinetic type and animated callouts that support a video someone is talking in. Read with scene-engine before addScene or editScene for these. Standalone motion design with no footage (launch films, product or feature reels, teasers, recreating a motion film or reference) uses motion-design instead. Scenes come with matching generated sound (music-and-sound).',
  body: `# Explainer scenes

An overlay illustrates the speaker’s claim; the transcript supplies its clock. Use addScene for the transparent drawing and GSAP for frame-seeked motion.

## Over footage

- For each overlay, identify the claim, its objects/relationship and transcript start/end with inspectAssetAnalysis. Leave the background transparent and keep drawings ≥24 design px from the face.
- Settle on the key noun; finish the exit by the next claim’s first word. Inspect both boundaries with getFrames so drawings do not pile up.
- Generate effects for visual hits only in full transcript gaps; omit a cue that cannot fit (music-and-sound).
- After building or changing motion, run checkPacing and the scene-engine/checklist rendered checks. For review-only requests, inspect requested times without editing.`,
};
