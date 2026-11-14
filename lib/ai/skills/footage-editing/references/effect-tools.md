---
name: "effect-tools"
description: "Exact controls, ranges, coordinate rules and examples for the motion, camera, effect and layout tools: animateClip, animateEffect, setVisualEffects, addTimedEffect, configureTimedEffect, configureSmoothZoom, configureCameraMotion, setSpeedRamp, setAudioReactive, setMask, blurRegion, applyLayout, trackPoints, followSubject, planEffects and previewRender. Read before using any of them."
---
# Effect, motion and camera tools

Each tool's description gives what it does and its argument rules. This page holds the rest: what each control means, typical values, and the rules that keep a call from doing the wrong thing. Use effects only for an explicit request or authorized creative styling, and choose restrained, purposeful ones from what the footage shows.

## Object motion: animateClip
- Moves a whole object on the canvas: a picture-in-picture video sliding in, an image overlay, a caption, a text graphic, a solid. It is object motion in canvas coordinates, not a camera and not an attachment to another clip. Pushing or panning inside footage is configureSmoothZoom or configureCameraMotion; animateClip moves the whole video frame.
- x/y are offsets in fractions of the canvas width and height from the object's static placement, never original-source coordinates. For video and image clips the tool maps them through the inverse static scale and rotation, so a small or rotated overlay still moves the requested canvas distance. Keep the static base layout and sources.
- Easing on an anchor controls the move into it: linear, ease-in-out, ease-out, focused-spring, or a cubic-bézier [x1,y1,x2,y2] with x1/x2 in 0..1; y above 1 overshoots. [0.34,1.56,0.64,1] is a springy pop, [0.7,0,0.84,0] a slow-start ease-in. Send the whole eased path in one call.
- First and last states hold outside the anchors: add an explicit 0-second baseline point when the motion must start later.
- Scattered words aligning into a line: inspect each word's static placement, give each its own final canvas offset and the same absolute timeline arrival time (converted to each clip's local time), include a hold before the alignment starts, keep every word a separate editable object, and change no unselected clip. Batch them with objects.
- Coordinate an image, text or solid with a footage camera path only when asked, planning each path in its own coordinate space. Never claim parenting, automatic attachment or continuous cursor tracking.
- Text motion replaces a basic text animation but keeps its styling and text-template settings.
- Add setMotionBlur afterwards for fast moves that should feel premium.

## Camera inside footage: configureSmoothZoom and configureCameraMotion
- Easing: focused-spring is a snappy zoom that settles without bounce (use it for a requested focused or spring-style zoom); ease-out starts fast and brakes smoothly; ease-in-out is the calm choice. easing is required on every keyframe.
- Named targets (a modal, a button, a cursor, an object): inspectFrames at a relevant SOURCE instant first and pass its targetId. The evidence must come from this request and match the retained source and zoom window. Never guess coordinates; explicit coordinates are only ones the user gave, in original displayed SOURCE pixels or 0..1, never preview-screen pixels. Existing crop and fit map the target automatically.
- framing center moves the target toward the canvas center; source-edge limits keep empty space from showing, so a target near an edge can stay off-center. Do not move the static clip to force centering. anchor keeps the target where it is on screen. Named targets default to center, generic and coordinate focus to anchor.
- configureCameraMotion: the same scale with a changing focus glides; a repeated focus and scale holds. To return wide, end on scale 1 at the clip's original view center: inspect the static framing rather than assuming a cropped or off-center clip is centered at .5,.5.
- mode glide is a planned route across static targets. mode follow is sampled movement: inspect distinct requested SOURCE instants and pass each returned targetId at its matching TIMELINE instant, within one source frame. Never reuse an old cursor position as a later one or claim continuous tracking between samples.
- blurAmount adds speed-driven directional blur while gliding (default off); it clears on holds and keeps any static directional blur.
- Both affect one footage clip, not text, other layers or the scene, and keep base transform, trims, speed and linked audio. One call stores the whole move: no per-frame calls.

## Footage effects: setVisualEffects and animateEffect
| Control | Meaning |
| --- | --- |
| colorGrade | exposure in stops (0 neutral); contrast and saturation 1 neutral; temperature, tint, vibrance 0 neutral |
| softBlur | the clip's Blur setting, amount in design px (0 clear); with transform opacity it makes a translucent blurred background layer |
| frameCorners | corner rounding, amount 0 square to 1 fully rounded |
| glitch | intensity 0..1; blockSize and rgbSplit in px at 1080 output height |
| invert | amount 1 gives negative colors |
| filmOverlay | procedural grain, dust, scratches, vignette, flicker and warmth, each 0..1, plus an overall amount; no generated footage |
| turbulentDisplace | amount in design px, scale (noise feature size) in design px, speed (0 holds it still) |
| vhs | scanlines, noise, bleed and tracking 0..1, overall amount, speed (0 freezes it) |
| bloom | amount (.3 subtle, .6 visible, 1.2 dreamy), threshold where glow starts (.65 typical), radius in design px |
| zoomBlur | radial amount, centerX/centerY |
| lensDistortion | amount warps the lens; fringing adds chromatic edges (set amount 0 for fringing alone) |

- Batch identical colors, corners or effects across several sources with clipIds in one call.
- animateEffect keyframes one control over time: a grade that drains color on a line (colorGrade.saturation 1 to 0.3), a blur-in reveal (softBlur.amount 20 to 0), a light leak that flares on a beat (lightLeak.amount), glitch that ramps up, heat haze (turbulentDisplace.amount), lens distortion with fringing. Set the group's other controls first with setVisualEffects.

## Timed FX: addTimedEffect and configureTimedEffect
- Punch is the returning pulse of the Zoom family: amount 1..3, speed .25..4, centerX/centerY 0..1. Optional attack and release are .01..30 seconds at 1× speed; speed scales both, and if they exceed the FX duration both shrink proportionally. Omitted timing keeps the legacy pulse; a partial edit keeps every omitted control.
- Quick zoom in and out are one Zoom family: direction in or out, amount 1..3 times normal framing, speed .25..4, centerX/centerY. Speed is progress across the FX range: 1 completes across it, faster reaches the target early and holds, slower ends partway.
- Solid color follows V layer stacking: below footage it is a background, above it an overlay. Its controls configure a solid-color frame or rectangle only.
- Frame shrink scales the footage itself toward the center with black on all four sides, then returns; it is not a solid rectangle.
- A saved legacy fade FX can keep duration edits; new fades are configureVisualFade (footage) and configureAudio (sound).

## Speed: setSpeedRamp
| Preset | Shape |
| --- | --- |
| montage | slow, fast, slow |
| hero | fast, slow-mo hit, fast |
| bullet | fast, near-freeze in the middle, fast |
| flash-in | slow, then whips in |
| flash-out | whips, then slows |
| ramp-in | half speed easing to normal |
| ramp-out | normal easing to half |
| slowmo-middle | normal, slow-mo through the middle, normal |

Custom anchors ease in and out by default (named easing or cubic-bézier). Align the slow part with the moment that matters: inspect it first. Read the new duration before any further timing edit.

## Music-reactive: setAudioReactive
Subtle reads best: scale 0.04–0.08 on beats (0.06 is a 6% bump), shake about 0.01 of the frame, rotate a few degrees; effect controls such as colorGrade.exposure 0.3, glitch.intensity 0.6 on accents, zoomBlur.amount 0.4. downbeats are bar starts, accents the strong hits.

## Masks: setMask
Examples: a box that grows from the center, an oval vignette that tightens on a punchline, a diagonal wipe, text that reveals b-roll. feather 0 is hard, 20–60 soft. To blur everything but one area, invert the mask on a blurred copy above the footage.

## Region blur: blurRegion
Hides private details while the rest stays sharp: an email or API key in a screen recording, a face, a number plate, a notification. Read one frame first (getFrames) and give the rectangle with a little room around the text; space:'frame' takes the rectangle as fractions of that rendered frame, otherwise it is 0..1 of the clip's source frame. Blur (default) or pixelate; strength 60 is the default, 40+ makes text unreadable, 80+ for faces. start/end are clip-local seconds when the detail is on screen only for a while; content that moves needs one region per stretch. Up to 8 regions per clip: replace:index or remove:index edits one, clear:true removes all. It is a clip property, so trims, splits and moves keep it, and preview and every export draw it the same.

## Layouts: applyLayout
- two-rows only sets framing: arrange overlapping row footage on separate V layers with timeline tools when needed. detectedRegions refuses uncertain or changing layouts.
- mirror-blur defaults: blur 24 (0–40), darken 0.45 stops (0–2). Selected clips need not share a layer. Trims, splits, moves, swaps and deletes keep the bands. Resolve existing custom object motion or legacy follow crop explicitly first; never remove it silently.

## Tracking: trackPoints and followSubject
- Explicit point or box seeds and existing inspectFrames targets skip paid grounding; choose a box with readFrames. Verify a detector box visually.
- The processor streams dense chunks across the range and re-acquires a distinctive target after loss; zero-confidence samples hide attached overlays and masks. Never invent motion through occlusion.
- followSubject active-speaker: short backchannels and uncertain or offscreen matches never switch the crop; crop changes cut at camera cuts and ease only between confirmed speakers inside a shot; an uncertain new shot starts from the stable center. Shot dominance is framing evidence, not voice identity, and the confidences are heuristics.

## Effect review: planEffects and previewRender
- Plan only what must be judged by eye. Derive acceptance criteria from the current request and decoded evidence; add no creative requirements of your own.
- Subject readability means the requested object stays recognizable, not that fine print becomes legible, unless the user asks for that.
- Describe observed action literally: a hand-held object moving through the air is not free flight. If the requested opening is ambiguous, inspect it before claiming a hover or release. Observed action needs an evidenceId from this run's inspectVideo; never invent an impact.
- Markers and cuts a plan refers to must still exist. Requested-time anchors are for explicitly requested timing. Long looks can be reviewed in a short sample window. Each FX pulse gets its own timed plan with its actual start and full duration.
- Reviewed expectations stay fixed; others can still be corrected. Attach an output for review with previewRender bindings instead of rewriting the plan.
- previewRender: finish the planned edits first. Do not resubmit the same out-of-window pair. A rejected window or a failed renderer is not a visual judgment. When another edit changes a passed check's visible scope, refresh only that one. Sparse stills cannot prove audio sync, continuous motion, contact between samples or the whole edit's taste. Never loop on an unavailable service.
