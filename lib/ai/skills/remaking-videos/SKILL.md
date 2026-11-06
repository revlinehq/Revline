---
name: "remaking-videos"
description: "Remakes a video the user shares, or borrows parts of it (a transition, a title style, the pacing, the look) for the user's own edit. Read before analyzing a reference, before a remake, and before borrowing any part of one; recreating a launch or motion film also needs launch-films-motions."
---
# Reference footage

The user shares a finished video and wants either a **remake** (the same edit made with their own material) or a **style borrow** (one or more parts of it applied to their edit). A good result starts with a short, concrete breakdown by shot id, uses measured numbers exactly, and checks every model reading in frames before it decides the build.

For original work inspired by a reference, follow launch-films-motions "A style reference": borrow the reasons behind its choices, never its imagery, layout or timing.

## Workflow
1. Break it down: run analyzeMedia with mode reference on the shared video.
2. Read positions, sizes and type from full-size frames: readFrames with crop, and measureFrame for exact colors and edges.
3. Reply with the breakdown (see Breakdown reply).
4. Ask, only if the message did not already say: remake it, or borrow which parts?
5. Load the page for the job (see Defaults) and build.
6. After building, go through writing-scenes page `checklist` for scenes and look at the result with getFrames at the shots that matter, sampled as writing-scenes page `edit-lanes` sets for the lane.

## Breakdown reply
- One line: what it is (genre), its length and shot count, the rhythm (median shot, cuts on the beat, bpm).
- One line per shot, grouping long runs of similar shots: id, time, transition in, what is on screen by part, title style when there is one. For example: "S4 (6.2 to 8.1 s): whip right in. Phone UI cropped to the composer, small grotesk headline blurs in, slow push in."
- The signatures by id (T1, T2), in a few words each.
- Mention once that the chat shows the breakdown as a card where the user can click shots and parts to add them to the next message.

## Defaults
| Job | Page to load |
| --- | --- |
| Remake of footage cut to music, including an ad made of footage | `social-edit` |
| Remake of a motivation or quote video | `motivation` |
| Remake of an ad, music video, vlog or tutorial | the closest of `social-edit` and `motivation` |
| Remake of a launch or motion film | `recreation`, plus the launch-films-motions skill |
| Borrow named parts | `borrow` |

## Rules
- The reference stays off the timeline unless the user asks for it there. A file dropped into an empty project lands on the timeline by itself: before building a remake, delete that reference clip from the timeline (it stays in media).
- Measure at full resolution, never from a downscaled contact sheet: a shrunk sheet makes type and objects look about half their real size.
- For a footage edit or style borrow, copy the edit using the user's material. For an explicitly requested motion-film copy, follow page `recreation` for exact visible content.
- For a footage remake, say what comes from the reference and what comes from the user's material.
- When the remake needs material the project does not have, list it per shot and ask before building (for example "S1 to S3: a slow establishing shot. S4: fast action on the drop").
- Measured numbers (shot lengths, cut times, beats, onBeatRatio) are exact.
- Transition kinds, camera moves and title styles are the model's reading. When one decides the result, or is unclear in the breakdown, check it with readFrames fps 10 on the reference around that shot's time before building.

## Pages
- `recreation`: the full motion-film recreation workflow: inventories, exact content, per-layer camera, rendered comparisons, close-out.
- `social-edit`: remaking footage cut to music, shot by shot on the user's beats.
- `motivation`: remaking footage under a voice with bold captions.
- `borrow`: applying one named part of a reference and how each part maps onto tools.
- `image-plates` (from launch-films-motions): real asset needs during a build.
