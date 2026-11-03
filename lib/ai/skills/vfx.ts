import type { EditorSkill, EditorSkillPage } from './index';

const montage: EditorSkillPage = {
  name: 'montage',
  description: 'Build a gameplay montage or kill edit: measured hits, beat cuts, velocity, blur, cutout layering and a final parallax hold.',
  body: `# Montage and kill-edit workflow

Use a project with the user's footage and music. On MCP, pass projectId and timelineId explicitly on every edit and inspection. Keep unrelated timelines intact. Inspect the retained shots and confirm the exact kill/hit frames with readFrames or inspectFrames in short source windows. Game motion peaks alone do not prove a kill. Convert SOURCE evidence to TIMELINE seconds after trims and speed changes.

1. Finalize the shot order. Analyze the song with analyzeMedia mode beats once, then markMusicBeats on the placed audio clip. Use kind accents for strong hits or beats/downbeats for the pulse. Drop candidates remain uncertain until heard. alignCutsToBeat uses the measured musicAssetId grid on consecutive V1 clips; it does not move the kill inside a shot. Leave enough source handles and inspect adjusted cuts.
2. For velocity, setSpeedRamp on the retained video with anchors x in 0..1 and rate .1..10, or preset hero/bullet. Start at 2× approach, 0.25× over a 0.2 s hit, then 1× recovery; convert to output-time anchors. The ramp changes clip duration and linked audio, so remeasure the kill's TIMELINE time afterward. Never assume an anchor x is a source fraction: it is the fraction along the resulting clip. Make room for slowed clips before applying a ramp.
3. smoothSlowMotion uses fal RIFE to add frames around slow parts. It costs fal credit and finishes in the background. Check the actual processed footage before claiming it is smooth. RIFE can smear HUDs and scene cuts; keep the processed source window within one shot.
4. setMotionBlur amount around .35 to .65 blurs animateClip/camera movement according to velocity. It does not create optical blur from a speed ramp alone. For a short footage rush use setVisualEffects zoomBlur, or a zoom-blur timed FX over the approach. End the blur as the kill lands so the hit is readable.
5. Add an impact frame on the confirmed hit with addImpactFrame at TIMELINE seconds, start at 1–3 frames; longer ranges are held looks. Add ≤1 flash/shake/punch; inspect pre-hit and recovery frames. Page impact-and-overlays has the controls.
6. For text behind a character, duplicate the footage in sync. Keep the original on a lower V layer, text above that, and the transparent copy above the text. removeBackground mode person uses person matting; mode foreground uses BiRefNet for salient game characters/objects. Use seed with the same point, box, object noun, or inspected target as trackPoints. For removeBackground, time is the TIMELINE seed second. Florence-2 grounds nouns and SAM2 follows that selected subject. Automatic BiRefNet falls back to SAM2 when empty. Inspect the mask and mute duplicate audio.
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

freezeFrameParallax accepts an optional seed at the freeze instant (the same seeds as trackPoints), clipId, TIMELINE at, duration .2..10 seconds and mode insert or hold. Insert moves later clips and markers; hold keeps audio playing and skips the held picture interval. It reuses the existing freeze extraction and placement. The original clip's framing and look are retained.

All inference is requested from the media worker, never computed inside Convex. Models run on fal.ai: Depth Anything V2 (fal-ai/image-preprocessors/depth-anything/v2), BiRefNet V2 General Use (Light) (fal-ai/birefnet/v2), and SDXL inpainting (fal-ai/fast-sdxl/inpainting). The worker needs its existing FAL_KEY. It extracts one frame, estimates depth and salient foreground, expands the hole around the matte, reconstructs the background, and stores background/source/matte/depth in a lossless PNG atlas capped at 1920 pixels per layer's longest edge. No local model weights are required. Inpainting invents hidden scenery; it is not recovered ground truth. Selected subjects use SAM2 from a point/box or a Florence-2 grounded noun. An empty automatic BiRefNet matte falls back to SAM2 before reporting failure.

The shared WebGL renderer samples the depth-displaced background and an independent foreground plane. Both use the same deterministic timeline clock in preview and export. amount 0.. .12 controls differential displacement; start around .025 to .04. panX/Y -1..1 chooses direction. orbit -8..8 degrees adds slight rotation/tilt; start around 1 to 3 degrees. zoom 1..1.3 adds a push. The renderer includes overscan to protect background edges. configureParallax changes these camera parameters without rerunning models. Adding a prepared atlas from the media library restores its parallax renderer automatically.

Use an empty-environment backgroundPrompt when the scene needs specific reconstruction, e.g. "Empty game corridor continuing the same wall, floor and lighting, no character or weapon". Automatic BiRefNet may choose a first-person weapon or HUD instead of the enemy. Supply a seed on the intended subject to use prompted segmentation. Inspect start/middle/end and matte boundaries on real footage. Halve amount/orbit for stretched edges or exposed seams. If still visible after one reduction, use freezeFrame and disclose the fallback. If the foreground is wrong, choose another frame or use the ordinary freezeFrame with a modest animateClip move. Do not describe that fallback as a depth reconstruction.
`,
};

const tracking: EditorSkillPage = {
  name: 'tracking',
  description: 'Attach overlays or masks to measured pixels, including gameplay with a moving camera.',
  body: `# Pixel tracking

Use trackPoints for a point or object that moves in source pixels, including Valorant aim/camera motion. Do not hand-read dozens of positions. Read a full-resolution frame at the desired seed time with readFrames and give a normalized SOURCE point/box, or reuse a confident inspectFrames targetId already available in the session. A short noun seed sends one native source frame to Florence-2 open-vocabulary detection on fal from the processor, using FAL_KEY. Explicit point/box seeds or an existing inspectFrames target skip paid grounding; use readFrames for free visual inspection and give a normalized source box. Gemini is never required for tracking. Inspect the detector box before claiming it identified the right object; empty or multiple detections need an explicit seed. Florence can also guess when the noun is absent; read getTrack summary.grounding for its proposed box/provider/time, compare it with a native source frame, and use an explicit source box if it is wrong. Do not claim semantic identity from a detector response alone.

Call trackPoints with footageClipId, time (TIMELINE seconds), seed:{kind:"point",x,y}, {kind:"box",box:{left,top,right,bottom}}, {kind:"target",targetId}, or {kind:"object",noun:"red crate"} for fal grounding in the media processor. Optional start/end are TIMELINE bounds. Choose the shot around the seed; No duration/frame cap: CPU tracking streams every frame forward/backward with source PTS. trackPoints returns a reusable trackId immediately while work continues in the background. Read getTrack for progress, then dense samples with SOURCE times and confidence, box scale/rotation, and stop reasons. Follow nextCursor with cursor to read every sample, or request time in SOURCE seconds for a nearby window. A pixel is a visible surface feature, not a semantic identity: choose a distinctive textured point or tight rigid box. Flat regions, repeated textures, heavy blur and deforming objects may stop early. Never claim it holds through unseen motion.

Attach with attachToTrack clipId:<overlay>, footageClipId:<footage>, target:{trackId}. Attach immediately, even while the track is queued; it begins following when ready. Reuse the same track for text, images, hit-marker graphics, glow/solid layers or video. offsetX/offsetY are canvas fractions; smoothing 0..1 defaults .35 and reduces jitter without time lag. Box scale/rotation follow by default; followTransform:false keeps overlay size/orientation fixed. You can pass target:{time,seed,start,end} to attachToTrack to measure and attach in one call. Keep target:"subject" for the existing face-based mode. Do not use face tracking to identify an arbitrary gameplay object.

Attachments store a compact reference. Preview and export load neighboring dense chunks through the shared motion runtime, including fit, crop, source speed ramps and footage camera transforms. The overlay hides outside the verified path rather than sticking to its last position at a cut/occlusion. getTrack reports its tracked range, minimum confidence and stop reasons; report a partial hold when tracking stops early. A lost track keeps searching across the requested range and re-acquires a visually matching patch. Zero-confidence samples mark missing evidence; attachments hide during those gaps. Never describe those gaps as a continuous verified hold. For mode:"mask", supply mask:{shape,width,height,feather}; use a synchronized footage copy. The tracked mask hides that layer outside its verified range, including for an inverted spotlight. Box tracks scale/rotate the mask too.

Check the seed, both extremes and the frames next to each stop with getFrames or readFrames at full resolution. Inspect every stop/reacquisition, zero-confidence gap and lowest-confidence decile; verify object identity against source frames. Tracking measures visible evidence, not guaranteed object identity or recovery through occlusion.
`,
};

export const vfx: EditorSkill = {
  name: 'vfx',
  description: 'Gameplay montages, Valorant kill edits and intentional VFX: velocity, impact frames, procedural overlays, foreground layering, depth parallax and cuts on measured beats and tracking on moving-camera footage.',
  body: `# VFX for montage edits

Confirm hits with readFrames, then align cuts to measured music accents (montage). Use addImpactFrame with project-frame durations and addOverlay with seeded textures (impact-and-overlays). freezeFrameParallax prepares depth/matte/background layers; inspect start/mid/end for seams (parallax). trackPoints/attachToTrack bind overlays or masks to measured pixels; report gaps (tracking). Keep unrelated timelines intact.`,
  pages: [montage, impactAndOverlays, parallax, tracking],
};
