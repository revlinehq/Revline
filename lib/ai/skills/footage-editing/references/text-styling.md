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
| Caption start/end (an edge under a frame into a neighbour stops at it; larger overlaps trim the neighbour, and one whose words are all in the retimed caption is removed) | setCaptionTiming |
| Words, or words and range together | editText (start/end retime it in the same call) |

## Rules
- Change animation with setTextAnimation only when the user asks for an animation change.
- Vertical captions stay out of the bottom 20% of the frame, where app controls sit, and at least 24 design px from faces. Check the extremes of any movement with getFrames.
- Use one look per text role: title, captions, callout.
- addSubtitlesFromTranscript makes phrases of at most six words, up to eight where a cut would leave a word alone on screen. The clip lane's clipper style is uppercase Montserrat Black, white with a black outline and no background, 1–3 words per caption, each word popping in as spoken with the active word in green; sentence-only transcripts get minimal captions instead.
- Caption presets (catalog captionPresets) pop the spoken word to popScale (default 1.14, 1.1 for presets 9–11) over popSpeed seconds (default 0.34); change those only when asked.
- Template controls (configureTextTemplate): strength (default 1), revealDuration in seconds (default .65) and stagger in seconds per character or word (default .07) never change clip duration, words or timing. Karaoke takes karaokeStyle box (a highlight pill behind the active word) or pop (words pop in as spoken, active word in the highlight color).

## Catalog
Every font, look, animation, template and text control, with guidance:

```json
{{revline:0}}
```
