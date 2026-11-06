---
name: "social-edit"
description: "Remakes an edit of footage cut to music (Instagram and TikTok edits, fan edits, velocity edits, sports and car edits)."
---
# Remake: social edit

The reference is footage cut to a song. What makes it is the rhythm: where cuts fall on the beat, how speed ramps into hits, and which flash, shake or zoom marks each one. A good remake keeps that rhythm on the user's footage and the user's track.

## Workflow
1. Find, in the user's footage, the moments that do the same job as each reference shot: the reveal, the action, the slow beat before a drop. Use analyzeMedia understand, then inspectVideo asking for the actual moments needed.
2. Measure the user's track with analyzeMusic and start it as skill `music` says.
3. Place the shots with the lengths and moves in Defaults.
4. Run alignCutsToBeat after placing the shots.
5. Rebuild the titles and captions and match the look.

## Defaults
| Reference shot field | Remake |
| --- | --- |
| Length | the reference shot's length in beats (from rhythm.bpm), not in seconds; seconds only when the reference has no music |
| transitionIn cut | a hard cut |
| transitionIn, any other kind | the addTransition preset from page `borrow` (Transition presets), at the reference's measured length and direction |
| Camera speed-ramp | setSpeedRamp into the hit |
| Shake on a hit | a short shake effect at that beat |
| Push-in | configureSmoothZoom or a zoom effect over the shot |
| Titles and captions | their style (size, weight, case, enter) rebuilt with the text tools, with the user's words |
| Look | the grade the reference describes (applyLut, setColorCurves, grain), on the user's footage |

## Rules
- Map the rhythm onto the user's beats (Defaults, Length): a cut that fell on a downbeat lands on a downbeat.
