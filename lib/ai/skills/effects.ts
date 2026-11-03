import { editorCapabilities } from '../editor-capabilities';
import type { EditorSkill } from './index';

// Built on read: the catalog module imports the skill index, so this must not run at import time.
export const effects: EditorSkill = {
  name: 'effects',
  description: 'Reference for every footage effect, timed FX, transition, keyframe, mask, tracking, speed, freeze, slow-motion, upscale, audio-reactive and motion-blur control, plus camera and object motion, with strength and timing guidance. Read before applying any visual effect, transition, camera move or object animation. For combinations read vfx-recipes; for color read color-grading.',
  get body() {
    const { skills: _skills, soundEffects: _sound, text: _text, captions: _captions, ...catalog } = editorCapabilities();
    return `# Effects

Anchor effects to an observed reaction, impact, reveal or measured beat. Start at the catalog’s subtle value; inspect before/peak/after with getFrames. Increase once only if the event remains unmarked and faces/text stay visible. Combine tools with vfx-recipes; measure color with analyzeColor before grading (color-grading).

## Camera and object motion

Independent added-object keyframes use animateClip for captions/text, uploaded image/video overlays and solid-color objects. This supports linear paths or 2–8 eased anchors including focused-spring. Object x/y are canvas-relative offsets from static placement, not source-target coordinates. Coordinate requested object movement with footage camera keyframes using each clip’s own local times. These independent paths do not attach or parent objects. For measured source-pixel attachment, use trackPoints and attachToTrack from vfx page tracking; footage cameras still affect only their own clip. Existing image camera motion requires explicit replacement permission before using object motion. Uploaded videos also support whole-frame overlay movement with animateClip or attachToTrack. Smooth uploaded-footage zooms use configureSmoothZoom, with one timed recipe for entrance/hold/return. Uploaded-footage camera gliding uses configureCameraMotion: batch 2–8 timed focus/scale anchors; same scale pans smoothly between targets, different scale also zooms. For sampled cursor/object following use mode follow, inspectFrames at distinct source instants and bind each returned targetId to its exact timeline time. These observed points guide interpolation; do not claim every cursor frame was tracked. Static target-to-target routes use mode glide. Both tools preserve original-source edits, audio and base framing. Destination easing controls each segment, including focused-spring. Camera paths affect the selected footage clip, not a global camera over separate text layers. For named visual targets first use inspectFrames to locate the target and pass its current-request targetId; never invent modal/cursor coordinates. Generic centered zooms need no analysis. Coordinate focus is only for the user’s explicit original-source coordinates. Existing arbitrary custom motion requires explicit permission to replace it.

## Catalog

Every effect, preset and control, with guidance on purpose, anchor, typical length, energy and strength:

\`\`\`json
${JSON.stringify(catalog)}
\`\`\`
`;
  },
};
