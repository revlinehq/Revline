---
name: "text-styling"
description: "Caption and title styling for footage edits: the default caption look, which tool changes what, placement, and the full catalog of fonts, looks, animations and text controls. Read before adding, styling or animating any caption or title."
---
# Text styling

Good text is readable at a glance, clear of faces and app controls, and styled the same way for each role (title, captions, callout).

## Workflow
1. New captions: run addSubtitlesFromTranscript after the final cuts. Their default look per lane is in the footage-editing Defaults.
2. Existing text: run inspectClip first, then change only the requested words or controls. Caption text or timing fixes follow footage-editing page `edit-lanes`, which also sets the frame checks.
3. Style in one call per change: batch the same appearance across exact clipIds.

## Defaults
| Change | Tool |
| --- | --- |
| Font, size, solid colors, position, rotation, blend, text case | styleCaptions (many clips) or styleTextClip (one) |
| Stroke, shadow, glow | setTextStyle |
| A named editable look | applyTextLook |
| Animation, including Word reveal and Pop-in words | setTextAnimation |
| Highlight or accent color of a template | configureTextTemplate |
| Copy one caption's look to others | applyCaptionStyle |
| Caption start/end | setCaptionTiming |
| Words | editText |

## Rules
- Change animation with setTextAnimation only when the user asks for an animation change.
- Vertical captions stay out of the bottom 20% of the frame, where app controls sit, and at least 24 design px from faces. Check the extremes of any movement with getFrames.
- Use one look per text role: title, captions, callout.

## Catalog
Every font, look, animation, template and text control, with guidance:

```json
{{revline:0}}
```
