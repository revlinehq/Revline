---
name: "borrow"
description: "Borrows one part of a reference (a transition, a title style, the pacing, the look) for the current edit and maps each part onto controls."
---
# Borrow a style

A good borrow changes only what the user named; everything else stays as it was (writing-scenes page `edit-lanes`, Direction and feedback).

## Workflow
1. Resolve what the user pointed at with inspectReference before building, whether named by id (S4, S4.title, T2) or in words ("the second transition", "the title at 0:07", "that zoom").
2. Say what was understood, by id ("S4's whip right, 0.35 s").
3. Apply the part with the tools in Defaults, only where the user asked.

## Defaults

### Parts
| Part | Apply with |
| --- | --- |
| Transition | addTransition with the closest preset (table below) and the measured seconds, on the cut the user named, or on every cut if they said so |
| Title style on text clips | setTextStyle, setTextAnimation or applyTextLook with the measured size, weight, case and enter |
| Caption style | styleCaptions |
| Title inside a scene | editScene, changing only the title's CSS and GSAP |
| Camera move on footage | configureCameraMotion or configureSmoothZoom |
| Camera move inside a scene | the scene's camera timeline |
| Pacing | trim and alignCutsToBeat (see Rules) |
| Look | grade with applyLut, setColorCurves or matchColor; texture with grain or vignette effects |
| Signature (T1, T2) | its recipe wherever the user asked, with the shots it lists as the model |

### Transition presets
| Reference kind | addTransition preset |
| --- | --- |
| whip | whip-pan, whipDirection as the reference moves (left, right, up, down, zoom, zoom-out) |
| zoom | zoom-through |
| dissolve | crossfade |
| blur | blur-dissolve |
| spin | spin-zoom |
| wipe | gradient-wipe (iris-wipe for a circle) |
| light-leak | film-burn |
| flash | no preset: a short white flash on the cut |

## Rules
- Pacing keeps the order of the user's shots and moves their cuts toward the reference's shot lengths, and onto beats when onBeatRatio is high. Say how many cuts moved.
