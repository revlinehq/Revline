import type { EditorSkill, EditorSkillPage } from './index';

const montage: EditorSkillPage = {
  name: 'montage',
  description: 'Build a gameplay montage or kill edit: measured hits, beat cuts, velocity, blur, cutout layering and a final parallax hold.',
  body: `# Montage and kill-edit workflow

Use a project with the user's footage and music. On MCP, pass projectId and timelineId explicitly on every edit and inspection. Keep unrelated timelines intact. Inspect the retained shots and confirm the exact kill/hit frames with readFrames or inspectFrames in short source windows. Game motion peaks alone do not prove a kill. Convert SOURCE evidence to TIMELINE seconds after trims and speed changes.

1. Finalize the shot order. Analyze the song with analyzeMedia mode beats once, then markMusicBeats on the placed audio clip. Use kind accents for strong hits or beats/downbeats for the pulse. Drop candidates remain uncertain until heard. alignCutsToBeat uses the measured musicAssetId grid on consecutive V1 clips; it does not move the kill inside a shot. Leave enough source handles and inspect adjusted cuts.
2. For velocity, setSpeedRamp on the retained video with anchors x in 0..1 and rate .1..10, or preset hero/bullet. Approach the confirmed kill fast, slow through its few key frames, then snap back. The ramp changes clip duration and linked audio, so remeasure the kill's TIMELINE time afterward. Never assume an anchor x is a source fraction: it is the fraction along the resulting clip. Make room for slowed clips before applying a ramp.
3. smoothSlowMotion uses fal RIFE to add frames around slow parts. It costs fal credit and finishes in the background. Check the actual processed footage before claiming it is smooth. RIFE can smear HUDs and scene cuts; keep the processed source window within one shot.
4. setMotionBlur amount around .35 to .65 blurs animateClip/camera movement according to velocity. It does not create optical blur from a speed ramp alone. For a short footage rush use setVisualEffects zoomBlur, or a zoom-blur timed FX over the approach. End the blur as the kill lands so the hit is readable.
5. Add an impact frame on the confirmed hit with addImpactFrame at TIMELINE seconds, usually frames 1 to 3. A longer duration is an intentional held look. Add at most one restrained flash, shake or returning punch on the same hit; preserve calmer frames around it. Page impact-and-overlays has the controls.
6. For text behind a character, duplicate the footage in sync. Keep the original on a lower V layer, text above that, and the transparent copy above the text. removeBackground mode person uses person matting; mode foreground uses BiRefNet for salient game characters/objects. It has no noun selector. Inspect the result before claiming an agent or gun was isolated. Mute duplicate audio. A tracked manual mask is the fallback when the matte chooses the wrong foreground.
7. Use freezeFrameParallax for the final confirmed kill if a readable foreground/background split exists. It inserts or holds the frame using freezeFrame semantics and runs depth, matting and background inpainting in the worker. Page parallax explains camera controls and limitations.
8. addOverlay places a small procedural light leak, film burn or flare around a cut, or dust/grain over a selected span. Cuts and effect ranges stay independent. Keep the HUD and hit readable.

After timing changes, inspectTimeline again and recheck beat cuts, hit frames, text and linked sound. getFrames at the frame before, every impact frame, the first frame after, both sides of each overlay cut and parallax start/middle/end. Use checkSound when the mix changes. Export only when the user asks.
`,
};
const impactAndOverlays: EditorSkillPage = {
  name: 'impact-and-overlays',
  description: 'Frame-exact impact looks and original procedural overlay recipes, with the existing montage effect controls.',
  body: `# Impact frames and overlay pack

addImpactFrame takes at plus exactly one of frames or duration. frames counts PROJECT frames. duration is seconds snapped to the project grid. One frame through 30 seconds is supported. At 60 fps, frames:2 is 1/30 second. Presets: invert, black-white, posterize, manga. intensity 0..1 mixes the stylized image with the original, threshold .05.. .95 sets ink/BW tone, levels 2..8 sets posterization, speedLines 0..1 draws radial lines around centerX/Y, and flash 0..1 mixes white into the held look. Flash lasts the chosen range; use a separate shorter FX for a pulse. configureImpactFrame changes the existing FX; moving or deleting its clip changes the cue or removes it. Footage effects and sound outside its range stay intact.

Example on a verified hit at 3.2 seconds: addImpactFrame {at:3.2,frames:2,preset:"manga",threshold:.48,levels:3,speedLines:.3,flash:.08}. Inspect those full-resolution frames, especially the player's silhouette and weapon edges.

addOverlay takes at plus frames or duration, and preset light-leak, film-burn, lens-flare, dust or grain. blend is screen, add or overlay; intensity is 0..1. color is a hex color; seed makes the procedural texture reproducible, speed 0 freezes it, and fade is the fraction of duration faded at EACH edge (0.. .5). The implementation is original procedural drawing, with no scraped assets or third-party texture pack. configureOverlay edits an existing overlay. For a .6-second transition over a cut at 4 seconds, set at:3.7,duration:.6,preset:"light-leak",blend:"screen",intensity:.45. Use overlay blend for neutral grain, screen/add for light. Avoid a one-frame overlay with a fade envelope: choose fade:0 for a single-frame stamp.

Existing tools:
- addTimedEffect preset flash, shake, punch or zoom-blur; configureTimedEffect accepts flash strength/attack/release and shake strength/speed/direction. Flash attack and release are fractions of the FX duration; punch attack/release are seconds. A one-frame accent should use addImpactFrame rather than a pulse with zero brightness at its first sample.
- setVisualEffects zoomBlur {enabled:true,amount:.12,centerX:.5,centerY:.5}; animateEffect can ramp zoomBlur.amount back to zero around the hit.
- setVisualEffects glitch {enabled:true,intensity:.15,blockSize:24,rgbSplit:4}; keep it brief with animateEffect or a split footage span.
- setVisualEffects bloom {enabled:true,amount:.4,threshold:.7,radius:18} for highlight glow.
- setVisualEffects lensDistortion {enabled:true,amount:0,fringing:2} for lens fringing without warping. Keyframe lensDistortion.fringing for a short pulse.
`,
};
const parallax: EditorSkillPage = {
  name: 'parallax',
  description: 'Prepare a depth and foreground atlas, inpaint the background, then move a 2.5D camera in the shared preview/export renderer.',
  body: `# 3D freeze-frame parallax

freezeFrameParallax takes clipId, TIMELINE at, duration .2..10 seconds and mode insert or hold. Insert moves later clips and markers; hold keeps audio playing and skips the held picture interval. It reuses the existing freeze extraction and placement. The original clip's framing and look are retained.

All inference is requested from the media worker, never computed inside Convex. Models run on fal.ai: Depth Anything V2 (fal-ai/image-preprocessors/depth-anything/v2), BiRefNet V2 General Use (Light) (fal-ai/birefnet/v2), and SDXL inpainting (fal-ai/fast-sdxl/inpainting). The worker needs its existing FAL_KEY. It extracts one frame, estimates depth and salient foreground, expands the hole around the matte, reconstructs the background, and stores background/source/matte/depth in a lossless PNG atlas capped at 1920 pixels per layer's longest edge. No local model weights are required. Inpainting invents hidden scenery; it is not recovered ground truth. A failed or nearly empty/full matte is reported rather than silently producing a flat move.

The shared WebGL renderer samples the depth-displaced background and an independent foreground plane. Both use the same deterministic timeline clock in preview and export. amount 0.. .12 controls differential displacement; start around .025 to .04. panX/Y -1..1 chooses direction. orbit -8..8 degrees adds slight rotation/tilt; start around 1 to 3 degrees. zoom 1..1.3 adds a push. The renderer includes overscan to protect background edges. configureParallax changes these camera parameters without rerunning models. Adding a prepared atlas from the media library restores its parallax renderer automatically.

Use an empty-environment backgroundPrompt when the scene needs specific reconstruction, e.g. "Empty game corridor continuing the same wall, floor and lighting, no character or weapon". BiRefNet is salient-foreground segmentation, not a text selector. A first-person weapon or HUD may become foreground instead of the defeated agent. Inspect start/middle/end and matte boundaries on real footage. Reduce the move if outlines stretch or background detail looks invented. If the foreground is wrong, choose another frame or use the ordinary freezeFrame with a modest animateClip move. Do not describe that fallback as a depth reconstruction.
`,
};

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
  description: 'Gameplay montages, Valorant kill edits and intentional VFX: velocity, impact frames, procedural overlays, foreground layering, depth parallax and cuts on measured beats and tracking on moving-camera footage.',
  body: `# VFX for montage edits

Read page montage for a kill-edit workflow. Page impact-and-overlays covers exact frame durations, looks, procedural textures and the existing montage effect controls. Page parallax explains the worker models, layer preparation, camera controls and honest limits. Page tracking covers pixel tracks and attached overlays or masks on a moving camera. Use observed hits and measured musical cues; preserve the user's requested style and unrelated edits.
`,
  pages: [montage, impactAndOverlays, parallax, tracking],
};
