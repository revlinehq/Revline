import type { EditorSkill, EditorSkillPage } from './index';

const tracking: EditorSkillPage = {
  name: 'tracking',
  description: 'Attach overlays or masks to measured pixels, including gameplay with a moving camera.',
  body: `# Pixel tracking

Use trackPoints for a point or object that moves in source pixels, including Valorant aim/camera motion. Do not hand-read dozens of positions. Inspect a full-resolution frame at the desired seed time with inspectFrames, then pass its targetId or normalized SOURCE point/box. A short noun seed localizes one unambiguous object once; if localization is uncertain, inspect and choose the box explicitly.

Call trackPoints with footageClipId, time (TIMELINE seconds), seed:{kind:"point",x,y}, {kind:"box",box:{left,top,right,bottom}}, {kind:"target",targetId}, or {kind:"object",noun:"red crate"}. Optional start/end are TIMELINE bounds. Choose the shot around the seed; there is no duration or frame-count cap. The CPU processor tracks every decoded frame forward and backward in streamed chunks, preserving real source PTS. trackPoints returns a reusable trackId immediately while work continues in the background. Read getTrack for progress, then dense samples with SOURCE times and confidence, box scale/rotation, and stop reasons. Follow nextCursor with cursor to read every sample, or request time in SOURCE seconds for a nearby window. A pixel is a visible surface feature, not a semantic identity: choose a distinctive textured point or tight rigid box. Flat regions, repeated textures, heavy blur and deforming objects may stop early. Never claim it holds through unseen motion.

Attach with attachToTrack clipId:<overlay>, footageClipId:<footage>, target:{trackId}. Attach immediately, even while the track is queued; it begins following when ready. Reuse the same track for text, images, hit-marker graphics, glow/solid layers or video. offsetX/offsetY are canvas fractions; smoothing 0..1 defaults .35 and reduces jitter without time lag. Box scale/rotation follow by default; followTransform:false keeps overlay size/orientation fixed. You can pass target:{time,seed,start,end} to attachToTrack to measure and attach in one call. Keep target:"subject" for the existing face-based mode. Do not use face tracking to identify an arbitrary gameplay object.

Attachments store a compact reference. Preview and export load neighboring dense chunks through the shared motion runtime, including fit, crop, source speed ramps and footage camera transforms. The overlay hides outside the verified path rather than sticking to its last position at a cut/occlusion. getTrack reports its tracked range, minimum confidence and stop reasons; report a partial hold when tracking stops early. A lost track stops; start another measured track after the occlusion rather than drawing an invented bridge. For mode:"mask", supply mask:{shape,width,height,feather}; use a synchronized footage copy. The tracked mask hides that layer outside its verified range, including for an inverted spotlight. Box tracks scale/rotate the mask too.

Check the seed, both extremes and the frames next to each stop with getFrames or readFrames at full resolution. Inspect low-confidence spans before claiming a continuous hold. Tracking measures visible evidence, not guaranteed object identity or recovery through occlusion.
`,
};

export const vfx: EditorSkill = {
  name: 'vfx',
  description: 'Visual effects on footage. Read the tracking page to attach overlays to moving-camera source pixels.',
  body: '# VFX\n\nLoad the page for the effect you are building. Existing color, motion and compositing controls are documented in effects and vfx-recipes.',
  pages: [tracking],
};
