---
name: "reference-footage"
description: "The user shares a video to remake or to take style from (an edit, a motivation video, anything; recreating a launch or motion film is motion-design) and points at parts of it (\"this transition, this title, this pacing\"). Read before analyzing a reference, before a remake, and before borrowing any part of one."
---
# Reference footage

The user shares a finished video and wants either a **remake** (the same edit made with their own material) or a **style borrow** (one or more parts of it applied to their edit).

For original work inspired by a reference, follow motion-design "A style reference": borrow the reasons behind its choices, never its imagery, layout or timing.

## 1. Break it down
- Run analyzeMedia with mode reference on the shared video. It measures the cuts and beats, then splits every shot into parts: transition in, camera, look, the screen's parts (background, footage, ui, title, caption, logo, product, person, cursor, shape, emoji, overlay) and title styles. It also writes the five-line style direction and the signatures (the moves that define the style).
- Measure at full resolution. Read positions, sizes and type from full-size frames (readFrames with crop, and measureFrame for exact colors and edges), never from a downscaled contact sheet: a shrunk sheet makes type and objects look about half their real size.
- The reference stays off the timeline. Never place it there unless the user asks for it. A file dropped into an empty project lands on the timeline by itself: before building a remake, delete that reference clip from the timeline (it stays in media).

## 2. Describe it
Reply with the breakdown, short and concrete:
- One line: what it is (genre), its length and shot count, the rhythm (median shot, cuts on the beat, bpm).
- One line per shot (group long runs of similar shots): id, time, transition in, what is on screen by part, title style when there is one. For example: "S4 (6.2 to 8.1 s): whip right in. Phone UI cropped to the composer, small grotesk headline blurs in, slow push in."
- The signatures by id (T1, T2), in a few words each.
The chat shows the breakdown as a card where the user can click shots and parts to add them to the next message. Mention this once.
Then ask, only if the message did not already say: remake it, or borrow which parts?

## 3. Remake or borrow
- **Remake:** load the page for the genre: `social-edit` or `motivation`; for ad, music-video, vlog or tutorial use the closest one (an ad of footage is social-edit). For a launch or motion film, load this skill's `recreation` page and motion-design. For a footage edit, say what comes from the reference and what comes from the user's material. If it needs material the project does not have, list it per shot and ask before building.
- **Borrow:** load `borrow`. Change only the named parts.

## Rules
- For a footage edit or style borrow, copy the edit using the user's material. For an explicitly requested motion-film copy, follow page `recreation` for exact visible content.
- Measured numbers (shot lengths, cut times, beats, onBeatRatio) are exact. Transition kinds, camera moves and title styles are the model's reading: when one decides the result, check it with readFrames fps 10 on the reference before building.
- After building, go through scene-engine page `checklist` for scenes, and look at the result with getFrames at the shots that matter.