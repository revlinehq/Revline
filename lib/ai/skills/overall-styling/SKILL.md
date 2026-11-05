---
name: "overall-styling"
description: "House defaults for films, footage overlays and diagrams: near-black UI, one accent, outlined isometric blocks, hatching, dimension lines and subtitles. Includes a working example. User-selected looks and measured recreations override these defaults."
---
# Overall styling

House defaults apply to invented graphics. Explicit user direction and measured literal references override them; confirmed brand fonts/colors override remaining defaults. Why: copying a reference and inventing a film require different choices.

## Everywhere

- Invented UI: surfaces #111–#202020, 1 px dividers, text #F5F5F5/#A6A6A6, one accent hue per shot at 1080-based size. No grids, scan lines or bright purple fills. Panel shadows only for a selected blueprint lift; subtitle shadow is specified below.
- Reuse one product component or blueprint across sections; vary state/framing. Use getBlueprint or measureScreen/compareScreen against the real app. Separate copies once produced three different Revline editors in one film.
- Choose a hold or motion that communicates the idea; getFrames/checkPacing verify it. The example demonstrates technique, not a required composition.

## Isometric line diagram (default)

Technical drawings that build themselves next to the speaker: ideas become outlined blocks, charts and measurements, never filled cartoons or icons.

### Palette
- Panel background #0C0C0C, or transparent with a dark gradient (transparent to rgba(0,0,0,.65 to .85)) where it sits over footage.
- Lines #D6D6D6 / #BDBDBD for main edges, #777 for axes and secondary posts, #888 for back edges and dimension lines. No background grids or grid lines: they are clutter.
- Text #F5F5F5 for figures and labels, #A6A6A6 for kickers and axis labels, #858585 to #999 for notes and captions.
- ONE accent, used on one edge or line per graphic: the subject's brand color when it has one (NVIDIA green #76B900 in the Jensen film), otherwise a muted single hue. Keep the diagram strokes flat and avoid glows. A requested grain gradient is allowed behind the diagram; the footage legibility gradient is also exempt.

### Drawing
- Isometric blocks: top face, front face and side face as separate paths, stroke 2.5, stroke-linejoin round. Faces get near-black fills (#111 to #202020), never solid color.
- Hatching on one face only: an SVG pattern of 45 degree lines, 9 to 10 px apart, stroke #404040 to #555, width 1.
- The accent sits on one edge, for example the block’s base (stroke 3).
- Stacked blocks show a relationship ("X carries Y"): the upper block sits on thin support posts (#777, stroke 2) drawn down to the lower one.
- Dimension lines under or beside a block: a thin line with end ticks (M x y H x2 plus short verticals), #888, stroke 1.5, with a small caption below it.
- Charts: thin axes (#777, 1.5) and no grid lines, values as 3 px round-capped lines, a small white dot (r 4 to 5) riding the line as it draws, an end label in mono.
- Labels inside blocks: Inter 25 to 27, weight 500, centered. Numbers in Geist Mono with tabular numerals.
- No headings/kickers or script repeated as titles. Labels ≤3 words inside a block or at a line’s end; at most one caption, ≤6 words, 18–20 px.

### Motion
- Lines draw on with DrawSVGPlugin (drawSVG 0% to 100%, power3.inOut, 0.6 to 1.2 s); blocks and labels reveal with a left-to-right clipPath wipe (inset(0 100% 0 0) to inset(0), power3.inOut, about 0.65 s).
- A stacked block drops in from about 38 px above while its clip opens (power3.out, 0.8 s).
- Build in reading order, keyed to the words: base first, then what it carries, then the label, then the dimension line and caption.
- Panels change by wiping or sliding (x 600 px, power3.inOut, 0.8 s), never by fading everything out.
- Let a completed graphic hold for recognition. Move a dot or count a value when it communicates change; avoid decorative drift.
- Counters animate with power3.out and settle on the spoken value.

### Subtitles
- Minimal: Inter 36 px, weight 500, white, a soft text shadow (0 2px 5px rgba(0,0,0,.65)), centered, no box, no color highlight.
- Up to 3 words per line, broken at punctuation or pauses over 0.3 s; each word appears at its spoken time.
- Subtitles move out of the graphic's way (they ride with the layout when a split screen opens or closes) instead of being covered.

### Layout over a talking head
- The speaker stays clear: graphics take the half of a split screen or the lower third, never cover the face.
- One graphic at a time; the previous one leaves before the next idea starts.
- The spoken words are already in the subtitles: never repeat them as titles on the graphic.