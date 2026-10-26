import { editorCapabilities } from '../editor-capabilities';
import type { EditorSkill } from './index';

// Built on read: the catalog module imports the skill index, so this must not run at import time.
export const effectsAndStyling: EditorSkill = {
  name: 'effects-and-styling',
  description: 'Guidance, controls, strength and timing for every visual effect, timed FX, text look, text animation and template, font, layout, object animation and camera move, plus the style playbooks. Read before applying effects, text styling or animation, camera or object motion, layouts, or any creative styling.',
  get body() {
    const { skills: _skills, soundEffects: _sound, ...catalog } = editorCapabilities();
    return `# Effects and styling

Use applyTextLook for an explicitly requested editable look, setTextAnimation for a separate animation selection, styleTextClip/styleCaptions for font/size/solid colors/position/rotation/blend, and setTextStyle for stroke/shadow/glow. Word Reveal/Pop-in/etc are animations, not styled presets. Every text style preserves existing animation, custom motion, effect color, strength, timing, stagger and word timings. Default text resets appearance only; the Neon Echo look provides editable appearance without adding or replacing motion. Change animation independently with setTextAnimation only when requested. Independent added-object keyframes use animateClip for captions/text, uploaded image overlays and solid-color objects. This supports linear paths or2–8 eased anchors including focused-spring. Object x/y are canvas-relative offsets from static placement, not source-target coordinates. Coordinate requested object movement with footage camera keyframes using each clip’s own local times. These are independent paths, not automatically attached or parented; do not promise automatic following or a global scene camera. Existing image camera motion requires explicit replacement permission before using object motion. Uploaded-video motion remains camera-only. Smooth uploaded-footage zooms use configureSmoothZoom, with one timed recipe for entrance/hold/return. Uploaded-footage camera gliding uses configureCameraMotion: batch 2–8 timed focus/scale anchors; same scale pans smoothly between targets, different scale also zooms. For sampled cursor/object following use mode follow, inspectFrames at distinct source instants and bind each returned targetId to its exact timeline time. These observed points guide interpolation; do not claim every cursor frame was tracked. Static target-to-target routes use mode glide. Both tools preserve original-source edits, audio and base framing. Destination easing controls each segment, including focused-spring. Camera paths affect the selected footage clip, not a global camera over separate text layers. For named visual targets first use inspectFrames to locate the target and pass its current-request targetId; never invent modal/cursor coordinates. Generic centered zooms need no analysis. Coordinate focus is only for the user’s explicit original-source coordinates. Existing arbitrary custom motion requires explicit permission to replace it.

## Full catalog

Every supported effect, preset, look, animation, font and control, with guidance on purpose, anchor, typical length, energy and strength:

\`\`\`json
${JSON.stringify(catalog)}
\`\`\`
`;
  },
};
