---
name: "talking-head-graphics"
description: "House look for graphics over footage: isometric line diagrams beside a talking head (near-black panels, outlined blocks, hatching, one accent edge, dimension lines), minimal captions and layout around the speaker, with a working example. Read before adding graphics or captions over footage; not for motion films made from scratch (launch-films-motions), and user direction and measured recreations override these defaults."
---
# Talking-head graphics

A good result reads like a technical drawing that builds itself next to the speaker, in step with the words: ideas become outlined blocks, charts and measurements, never filled cartoons or icons. The face stays clear, one graphic is on screen at a time, and the captions stay readable around it.

## Workflow
1. Check scope: graphics and captions over footage only. Motion films made from scratch (launch, feature, teaser films) follow launch-films-motions and its pages instead; nothing in this skill applies to them.
2. Check what overrides the house defaults (see Rules) before choosing colors and fonts.
3. Turn the spoken idea into an isometric line diagram, the default. Choose a hold or motion that communicates the idea; page `example` demonstrates technique, not a required composition.
4. Key each piece to its word in the transcript and build in reading order: base first, then what it carries, then the label, then the dimension line and note.
5. Verify the rendered result with getFrames.

## Defaults

### Palette
| Element | Value |
| --- | --- |
| Panel background | #0C0C0C; over footage, transparent with a dark gradient (transparent to rgba(0,0,0,.65 to .85)) |
| Main edges | #D6D6D6 / #BDBDBD |
| Axes and secondary posts | #777 |
| Back edges and dimension lines | #888 |
| Block faces | near-black fills, #111 to #202020 |
| Hatching | #404040 to #555 |
| Figures and labels | #F5F5F5 |
| Kickers and axis labels | #A6A6A6 |
| Notes | #858585 to #999 |
| Accent | the subject's brand color when it has one (NVIDIA green #76B900 in the Jensen film), otherwise one muted hue |
| Invented UI over footage | surfaces #111 to #202020, 1 px dividers, text #F5F5F5 / #A6A6A6, one accent hue per shot, sized for a 1080 frame |

### Drawing
| Element | Spec |
| --- | --- |
| Isometric block | top, front and side faces as separate paths, stroke 2.5, stroke-linejoin round |
| Hatching | on one face only: an SVG pattern of 45 degree lines, 9 to 10 px apart, stroke width 1 |
| Accent edge | one edge, for example the block's base, stroke 3 |
| Support posts | stroke 2, from the upper block down to the lower one |
| Dimension line | a thin line with end ticks (M x y H x2 plus short verticals), stroke 1.5, a small note below it |
| Chart | axes stroke 1.5; values as 3 px round-capped lines; a small white dot (r 4 to 5) riding the line as it draws; an end label in mono |
| Block label | Inter 25 to 27, weight 500, centered, at most 3 words |
| Numbers | Geist Mono with tabular numerals |
| Note | at most one per graphic, at most 6 words, 18 to 20 px |

### Motion
| Move | Spec |
| --- | --- |
| Lines draw on | DrawSVGPlugin, drawSVG 0% to 100%, power3.inOut, 0.6 to 1.2 s |
| Blocks and labels reveal | left-to-right clipPath wipe, inset(0 100% 0 0) to inset(0), power3.inOut, about 0.65 s |
| Stacked block | drops in from about 38 px above while its clip opens, power3.out, 0.8 s |
| Panel change | wipe or slide, x 600 px, power3.inOut, 0.8 s |
| Counter | power3.out, settling on the spoken value |

### Captions
| Property | Value |
| --- | --- |
| Type | Inter 36 px, weight 500, white |
| Shadow | 0 2px 5px rgba(0,0,0,.65) |
| Placement | centered, no box, no color highlight |
| Line | up to 3 words, broken at punctuation or pauses over 0.3 s |
| Timing | each word appears at its spoken time |

## Rules
- Explicit user direction and measured literal references override the house defaults; confirmed brand fonts and colors override the remaining defaults. Why: copying a reference and inventing a film require different choices.
- One accent per graphic, on one edge or line.
- Keep diagram strokes flat, without glows. A requested grain gradient behind the diagram is allowed, and the footage legibility gradient is exempt.
- No background grids or grid lines: they are clutter.
- No scan lines or bright purple fills; block faces are never solid color.
- Stacked blocks show a relationship ("X carries Y"): the upper block sits on thin support posts.
- No headings or kickers, and never repeat the spoken words as titles on the graphic: they are already in the captions. Labels sit inside a block or at a line's end.
- The speaker stays clear: graphics take the half of a split screen or the lower third, never cover the face.
- One graphic at a time; the previous one leaves before the next idea starts.
- Panels change by wiping or sliding, never by fading everything out.
- Let a completed graphic hold for recognition. Move a dot or count a value when it communicates change; avoid decorative drift.
- Captions move out of the graphic's way (they ride with the layout when a split screen opens or closes) instead of being covered.

## Pages
- `example`: a complete stacked isometric diagram scene module, plus how to draw charts, bars, counters and structures the same way.
