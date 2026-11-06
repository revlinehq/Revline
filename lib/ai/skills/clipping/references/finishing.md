---
name: "finishing"
description: "Optional captions in the clipper style, pacing, sound, loudness, hook text and niche styles for finished shorts, with restrained defaults."
---
# Optional finish

A finished short is a hook-to-payoff cut that keeps the clipping defaults, plus only the embellishments the user asked for or the selected style calls for.
Follow the user's explicit choices or selected style. Captions, dead-air removal, speed-ups, zoom punches, hit effects, light music and hook text are optional: never force them into every short or let choosing them block delivery.

## Workflow
1. Finalize timing first (pacing, cuts), so captions and overlays stay in sync.
2. Add captions with addSubtitlesFromTranscript from saved word timings, then any hook text.
3. Settle the mix: fades, ducking, volume balance.
4. Normalize loudness only on an explicit request, after everything above.
5. Check the final length is still 15–60 s.

## Defaults
Clip-lane captions (the clipper style addSubtitlesFromTranscript creates in this lane):

| Property | Default |
|---|---|
| Background | None |
| Font | Montserrat Black, uppercase |
| Color | White with a bold black outline |
| Words per caption | 1–3 |
| Motion | Each word pops in as spoken (karaoke template, karaokeStyle pop) |
| Spoken word | Highlighted green, #22C55E |

An explicit user caption style wins: pass style minimal, or restyle with styleCaptions, setTextStyle or configureTextTemplate.

Loudness, only on an explicit normalization or audio-improvement request: -14 LUFS integrated, at most -1 dBTP, on the whole timeline mix of each finished tab.

## Rules
Captions and hook text:
- For caption and hook-text styling, read skill footage-editing page text-styling.
- Hook text comes from the actual moment, without invented claims.
- Keep text clear of faces, essential gameplay and platform controls.

Pacing:
- For speech cleanup, read skill footage-editing; use configureSmoothZoom for zooms.
- Remove dead air or speed up only when requested or part of the selected style.
- Preserve comedic pauses, reactions and intelligible speech.

Sound:
- Keep speech and important game or room sound intelligible.
- Add hit effects or light music only when requested or selected.
- Inspect the mix with getSound or checkSound, balance with setVolume, and use configureAudio for fades and music ducking.
- Normalize the whole tab mix, music and effects included; target one linked sound clip only when that is the intent.
- Respect an explicit request to keep the original loudness, removing any existing normalization.

Niche styles, applied only when selected and only for their useful embellishments:
- Gaming: the facecam over gameplay stack and the real reaction.
- Podcast: clear speaker turns and intact thoughts.
- IRL: stable subject framing and situational context.
- Sports: the action and its outcome, with essential ball, player and score context visible.
