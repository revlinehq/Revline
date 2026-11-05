---
name: "text-styling"
description: "Text and captions: fonts, looks, animations, templates, gradients, stroke/shadow/glow, placement and caption styling, with every control and its limits. Read before adding, styling or animating any text, title or caption."
---
# Text styling

New subtitles default to minimal readable static text with NO background, using a subtle outline/shadow as needed. Respect explicit no-captions or requested backgrounds/animations. Defaults never authorize restyling existing captions.

For existing text, inspectClip first; change only requested words or controls and check getFrames locally (scene-engine/edit-lanes).

Use applyTextLook for an explicitly requested editable look, setTextAnimation for a separate animation selection, styleTextClip/styleCaptions for font/size/solid colors/position/rotation/blend, and setTextStyle for stroke/shadow/glow. Word Reveal/Pop-in use setTextAnimation, never applyTextLook. applyTextLook preserves animation, custom motion, effect color/strength/timing, stagger and word times. Default text resets appearance only; the Neon Echo look provides editable appearance without adding or replacing motion. Change animation independently with setTextAnimation only when requested.

Vertical captions avoid the bottom 20% and stay ≥24 design px from faces; inspect movement extremes with getFrames. App controls cover that bottom area. Use one look per text role: title, captions, callout.

## Catalog

Every font, look, animation, template and text control, with guidance:

```json
{{revline:0}}
```
