---
name: "borrow"
description: "Borrowing one part of a reference (a transition, a title style, the pacing, the look) for the current edit, and how each part maps onto controls."
---
# Borrow a style

Change only what the user named. Every other clip, title, timing, color and sound stays exactly as it was.

## Find what they pointed at
The message names shots and parts by id (S4, S4.title, T2) or in words ("the second transition", "the title at 0:07", "that zoom"). Resolve both with inspectReference before building, and say what you understood by id ("S4's whip right, 0.35 s"). When a part is unclear in the breakdown, look at it with readFrames fps 10 on the reference around that shot's time.

## Mapping
- A transition: addTransition with the closest preset and the measured seconds, on the cut the user named, or on every cut if they said so. whip is whip-pan, zoom is zoom-through, dissolve is crossfade, blur is blur-dissolve, spin is spin-zoom, wipe is gradient-wipe (or iris-wipe for a circle), light-leak is film-burn, flash is a short white flash on the cut.
- A title style: text clips get setTextStyle, setTextAnimation or applyTextLook with the measured size, weight, case and enter; captions get styleCaptions. Titles inside scenes change with editScene: only the title's CSS and GSAP, nothing else in the scene.
- A camera move: configureCameraMotion or configureSmoothZoom on footage; the scene's camera timeline inside scenes.
- Pacing: keep the order of the user's shots and move their cuts toward the reference's shot lengths (and onto beats when onBeatRatio is high), with trim and alignCutsToBeat. Say how many cuts moved.
- The look: grade with applyLut, setColorCurves or matchColor; texture with grain or vignette effects.
- A signature (T1, T2): apply its recipe wherever the user asked, with the shots it lists as the model.
