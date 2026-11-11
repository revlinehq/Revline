---
name: "talking-head-graphics"
description: "Sets the house look for titles and captions over a talking head: minimal captions, short text titles and layout around the speaker. Read before adding titles or captions over footage; user direction overrides these defaults."
---
# Talking-head graphics

A good result keeps the face clear, shows one title at a time in step with the words, and leaves the captions readable around it.

## Workflow
1. Check what overrides the house defaults (see Rules) before choosing colors and fonts.
2. Key each title to its word in the transcript (inspectAssetAnalysis) and add it with addGraphic; style it with applyTextLook, setTextStyle or applyTextTemplate.
3. Place titles in the lower third or in the free half of a split screen (applyLayout), never over the face.
4. Call finish and look at the frames it returns; use getFrames only for a spot that looks wrong.

## Defaults

### Titles
| Property | Value |
| --- | --- |
| Type | Inter, weight 500, #F5F5F5; numbers in Geist Mono |
| Length | at most 3 words; one note of at most 6 words |
| Accent | the subject's brand color when it has one, otherwise one muted hue |
| Over footage | no box; a dark gradient or shadow only where the footage needs it for legibility |
| Entrance | a short wipe or fade (setTextAnimation, applyTextTemplate), about 0.65 s |

### Captions
| Property | Value |
| --- | --- |
| Type | Inter 36 px, weight 500, white |
| Shadow | 0 2px 5px rgba(0,0,0,.65) |
| Placement | centered, no box, no color highlight |
| Line | up to 3 words, broken at punctuation or pauses over 0.3 s |
| Timing | each word appears at its spoken time |

## Rules
- Explicit user direction overrides the house defaults.
- Never repeat the spoken words as a title: they are already in the captions. A title names the idea, a number or a label.
- The speaker stays clear: titles take the free half of a split screen or the lower third, never cover the face.
- One title at a time; the previous one leaves before the next idea starts.
- Let a title hold long enough to read. Avoid decorative drift.
- Captions move out of a title's way instead of being covered.
