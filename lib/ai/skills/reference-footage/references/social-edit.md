---
name: "social-edit"
description: "Remaking an edit of footage cut to music (Instagram and TikTok edits, fan edits, velocity edits, sports and car edits)."
---
# Remake: social edit

The reference is footage cut to a song. What makes it is the rhythm: where cuts fall on the beat, how speed ramps into hits, and which flash, shake or zoom marks each one. Remake the edit, using the user's footage.

## Footage
- The user's footage is the material. Find the moments that do the same job as each reference shot: the reveal, the action, the slow beat before a drop. Use analyzeMedia understand, then inspectVideo with the actual moments you need.
- No footage in the project: list what each shot needs (for example "S1 to S3: a slow establishing shot. S4: fast action on the drop") and ask for it. Never put the reference's own footage on the timeline as the remake.

## Music
- Use the user's track and measure it (markMusicBeats or analyzeMedia beats). The reference's audio stays off the timeline unless the user asks for it.
- Map the reference's rhythm onto the user's beats, not onto seconds: a cut that fell on a downbeat lands on a downbeat; a two-beat shot stays two beats. Use alignCutsToBeat after placing the shots.

## Shot by shot
- Length: the reference shot's length in beats (from rhythm.bpm), not in seconds, unless the reference has no music.
- transitionIn: cut is a hard cut; every other kind maps to an addTransition preset as on page `borrow` (Mapping), at the reference's measured length and direction.
- camera speed-ramp becomes setSpeedRamp into the hit. shake on a hit becomes a short shake effect at that beat. push-in becomes configureSmoothZoom or a zoom effect over the shot.
- Titles and captions: rebuild their style (size, weight, case, enter) with the text tools, with the user's words.
- Look: match the grade the reference describes (applyLut, setColorCurves, grain), using the user's footage as the base.
