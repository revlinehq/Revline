---
name: "footage-editing"
description: "Edits the user's footage and audio (talking heads, vlogs, podcasts, reels, screen recordings): cuts, speech cleanup, captions, b-roll, layers, transitions and effects. Read before editing footage or audio; small fixes to an existing edit start with writing-scenes page edit-lanes."
---
# Editing footage

A good footage edit keeps every retained word intact and in sync, removes only what the user asked to remove, and leaves unrelated clips, approved work and existing styling untouched. Decisions rest on saved evidence (transcript, audio, frames), never on guesses.

## Workflow
1. Run inspectTimeline for current clip IDs, layers and approved work. Edit around approved clips.
2. For a plain talking-head edit in the reel lane, follow the reel skill. For a small fix to an existing edit, follow writing-scenes page `edit-lanes`.
3. Read only the evidence the request needs: the saved transcript for speech edits, frames for visual edits (page `speech`).
4. Make the core edit in as few calls as possible: one retainSourceRanges or cleanSpeech call for speech, exact clipIds batches for identical changes.
5. Add captions after the final cuts (page `text-styling`).
6. Add effects only when the user asked for them or authorized creative styling (page `layers-and-effects`).
7. Check the result with inspectTimeline (duration, gaps, linked audio, caption sync), then run the checks writing-scenes page `edit-lanes` gives for the lane.
8. Report what changed, including the speechCleanup summary in one short sentence (for example: "Removed 74 pauses and 3 filler words, 12.4 s.").

## Defaults
| Setting | Default |
| --- | --- |
| New captions (all lanes except clip) | Minimal, readable, static text, no background; subtle outline or shadow allowed |
| New captions (clip lane) | Clipper captions from addSubtitlesFromTranscript (clipping page `finishing`) |
| Speech cuts | retainSourceRanges with tightenSilence:true |
| Transcript reads | SOURCE windows of at most 30 s |
| J/L cut offset | 0.1–0.2 s, only where it helps |
| Tracks | V 1–24 (video, images, text, solids), A 1–12 (audio), FX 1–24 (effects only) |

## Rules
- Ordinary trims, moves and splits never authorize decoration such as effects, music or punch-ins.
- Any song in the edit (where it starts, cutting to it, length, ending, ducking) follows skill `music`.
- An explicit user request (style, timestamps, keeping pauses, no captions) overrides every default here.
- Defaults apply to new work only; never restyle existing captions or clips unasked.
- Identify user-named footage from inspected project references; never claim a source or object is absent without inspection evidence.
- Use saved analysis that exists; request only the missing evidence, and run addSubtitlesFromTranscript, useStrongestMoment or alignCutsToBeat only after their analysis exists.
- When a cut boundary is uncertain, keep the footage rather than spending the run rechecking every boundary.
- For rough-cut cleanup plus captions, make the core cuts and add the captions before any optional repeated visual checks.

## Example
"Cut the pauses and add captions" on a 3-minute talking head, outside the clip lane:

```
inspectTimeline                         → clip v1, no approved work
cleanSpeech { clipId: "v1" }            → speechCleanup summary from the saved transcript
addSubtitlesFromTranscript { assetId }  → minimal captions, no background
inspectTimeline                         → duration, no gaps, captions in sync
```

Reply: "Removed 74 pauses and 3 filler words, 12.4 s, and added captions."

## Pages
- speech: transcript reading, speech cuts and cleanup, J/L cuts, and when to look at the picture.
- text-styling: caption and title defaults, styling tools, placement, and the full text catalog.
- layers-and-effects: tracks and layers, b-roll, undo and revisions, speed, and effect planning rules. Transitions: the `transitions` skill.
