---
name: "framing"
description: "Gaming facecam above gameplay, or speaker-led podcast and IRL reframing in 9:16, using measured existing tools."
---
# Vertical framing

Good framing keeps faces, the facecam and the key action in view without stretching, guessing coordinates or claiming confidence the analysis does not have.
Ordinary podcast and talk shorts keep the source view: use fitClip fit "contain" if needed to keep the full picture, and do not auto-track, crop or analyze faces. Existing user framing stays intact.

## Defaults
Apply this page only to gaming or action sources and to explicit visual reframing requests.

| Situation | Default |
|---|---|
| Requested vertical reframing | 9:16 canvas, fitClip fit "cover" on every single-view video |
| User wants the complete wide frame | fitClip fit "contain" (leaves large empty bars on a vertical short) |
| Confident facecam overlay | Two rows: creator on top, gameplay below |
| Creator-only or gameplay-only | One source filling the frame with the supported crop |
| Uncertain or unbordered layout | followSubject mode "face", or a stable wider view if no face is clear |
| Fixed single speaker | One measured stable crop |
| Co-visible speakers exchanging turns | fitClip "cover", then followSubject mode "active-speaker" |

## Gaming: creator above gameplay
Workflow:
1. Run detectFacecam once per source asset.
2. Inspect the saved facecam samples inside the retained range. If the layout kind or boxes change, split the video at those confirmed source times.
3. Make two synchronized video instances from the same asset and source range on separate V layers (duplicateClips), keeping one audible source track.
4. Call applyLayout two-rows with detectedRegions:true, creator clips on top and gameplay clips below.
5. Use cropClip only for a measured refinement.

Rules:
- A face rectangle alone is not the webcam panel; never invent a panel from a face box.
- Read frames at retained-range boundaries and layout changes: detection samples cannot prove the layout between them.
- Never apply the layout across a known layout change; split first.
- Resolve a refused layout on the split sections before finishing. Do not delete one row and silently abandon the failed layout.
- For creator-only or gameplay-only sources, do not build a duplicate empty row.
- For an uncertain layout, inspect the affected source range before choosing followSubject or a wider view.
- Never report a low-confidence panel as certain.

## Speaker reframing and visual IRL cuts
Workflow:
1. For a batch with co-visible speakers, call analyzeMedia mode "speakers" for each accepted source window before changing tabs, at most two calls at a time. Skip this for fixed single-speaker shots.
2. In each tab, apply the default for the shot type from the Defaults table.
3. Read the per-short framing receipt and the saved framing intervals around each switch.

Rules:
- Do not run mouth matching on a single speaker who never changes.
- Reuse saved framing when its coverage includes the short; never analyze the whole source per tab.
- If the crop follows the wrong person, turn following off and keep a wider view.
- Report fallback seconds explicitly.
- Speaker IDs and faceIds from separate analysis windows are not the same people; never equate numeric voice IDs with real-world names.

## Measuring and QA
- Use source readFrames only while measuring framing: panel edges, layout changes and active-speaker crops, after planClips accepts candidates.
- Reuse saved analysis across every short.
- Requested framing QA on a finished tab uses only the checkClip framing sheet. Glance once for face or facecam crop, mouths, key action and text visibility.
- Fix an affected crop and rerun checkClip. Report sampled coverage and fallback seconds; never check finished shorts frame by frame.

## Example
Confident overlay, retained range already split at layout changes:

```
detectFacecam { assetId: "<source>" }
duplicateClips { clipIds: ["<video>"] }            → new video V2 + audio A2
setVolume { clipId: "<A2>", volume: 0 }
applyLayout { layout: "two-rows", detectedRegions: true,
              topClipIds: ["<V2>"], bottomClipIds: ["<video>"] }
```
