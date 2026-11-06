---
name: "launch-films-motions"
description: "Sets the motion, timing, sound and style rules for films made from scratch with no footage on screen: launch and feature films, teasers, standalone motion scenes and shot-for-shot copies of a reference. Read it before building, restyling or editing any of them; scene-engine covers the code."
---
# Launch films and motion

A good film says one true message in the user's brand, moves fast with short beats and quick exits, and changes only what the user asked for. Every fact on screen comes from the user.

Terms: a **film** is the output; a **section** is one `section(...)` call; a **beat** is one idea on screen inside a section (a title, a UI state, a feature); a **move** is one animation; a **reference** is a video being copied.

Contents: Workflow; Defaults (timing and easing, sound levels); Rules (structure, timing, sound, recreating a reference, a new film for the user's brand, never speculate, taste, direction and feedback); Pages.

## Workflow
1. **Existing film:** start with scene-engine page `edit-lanes` and follow it instead of the steps below.
2. **Recreation:** follow "Recreating a reference" below.
3. **New film:** read page `ideation`. When the user accepts an angle, start building.
4. **Look:** find or create the brand kit (page `brand-kit`), then build the background (page `backgrounds`) before the first addFilm.
5. **Assets:** page `image-plates` for anything code cannot draw; page `blueprints` when the user's product UI is shown.
6. **Build** the film with addFilm as scene-engine page `films` describes, timing every move from "Timing and easing" below.
7. **Sound:** add music as "Sound" below says.
8. **Check** with scene-engine page `checklist` before handing it back.

## Defaults

### Timing and easing
Defaults for original films. The user's direction and a reference being copied win.

| Move | Duration | Ease | Example |
|---|---|---|---|
| Typical move (anything) | 0.25–0.6 s, aim 0.38 s | | A card sliding 120 px: 0.4 s |
| Entrance | 0.25–0.55 s, aim 0.35 s | `power3.out` (default), `power2.out` | Headline in: 0.35 s power3.out |
| Exit | 0.2–0.4 s, aim 0.3 s | `power2.in` | Headline out: 0.28 s power2.in |
| Between two resting spots | 0.35–0.6 s, aim 0.5 s | `power2.inOut` | Panel docking to the sidebar: 0.5 s |
| Camera move (push, pan, pull-back) | 0.8–1.4 s | `power3.inOut` or `power2.inOut` | Push-in to the composer: 1.0 s |
| Beat (one idea on screen) | 1.75–3.5 s, aim 2.45 s | | A title, a UI state, a feature |

### Sound levels
| Mix | Level |
|---|---|
| Music, film with no speech | about -14 LUFS |
| Music under speech | ducked 8–10 dB |

## Rules

### Structure
- Length, number of sections and content follow the user's request and brief. There is no default structure and no required proof beat.
- The pacing rules below apply at any length.
- Named transitions (letter reveal, write-on, mask wipe, blur-in, morph, typing, fly-off) each have a recipe page; page `transitions` maps motion words to them.

### Timing
- **Exits are faster than entrances:** about 0.8× the entrance time, with an ease-in (enter 0.35 s power3.out, exit 0.28 s power2.in).
- Never exit with the entrance's ease or duration, and never with a slow fade.
- **Only the camera runs past 1 s.** A non-camera move over 0.6 s needs a reason (a progress bar, a long draw-on).
- A non-camera move over 1 s gets split or sped up. Failing examples: a 1.8 s zoom on a UI element, 1.75 s of typing.
- **Curve mix:** `power3.out` for most moves, then `power2.out` and `power2.in`.
- `back.out` and `expo.out` are rare: at most one or two per film, for one deliberate snap or playful landing, never as the default.
- **A beat over 4 s** needs a second action inside it (a camera move, a new element, a state change), not a held frame.
- **Typing and UI demos run fast:** 2–3× real speed, so a 40–50 character prompt takes at most 1 s.

### Sound
- **Music only by default:** one music track and no generated sound effects.
- Add effects with generateSound only when the user asks; a few mistimed effects make a film feel stop-start.
- **The user's track wins:** when they name or upload a song, use it (addMedia) and say once that publishing it needs a license.
- With no track given, suggest one with matchMusic and let the user hear it before building around it.
- **Cut on the bar:** markMusicBeats on the track, then put section starts and big moves on bar lines.
- One bar is 4 × 60 / BPM s (1.88–2.0 s at 120–128 BPM), so a beat of 1–2 bars fits the beat length above.

### Recreating a reference (clone, remake, "shot for shot")
- The reference is the brief: no brand kit and no brand questions.
- New recreations use the recreate lane, which runs full checks.
- Read reference-footage page `recreation` before building a copy or making a full-lane edit. It owns the recreation workflow.
- Its measured behavior wins over the motion defaults on this page.

### A new film for the user's brand
- Use the brand kit's fonts, colors and logo.
- Skip the product-text interview unless the film states product facts the user has not given.
- **Product UI only when asked:** rebuild the user's real UI only when they ask to show their product, page or components.
- Otherwise design the film's own UI and objects freely in the brand's fonts and colors.
- Product UI shown in several sections is built once and reused.
- Per shot: when the whole UI moves or holds, use the screenshot (`media.<screen>`).
- When something inside the UI moves, zooms past 2× or changes text, use the kit's blueprint.

### Never speculate
- Every fact on screen comes from the request, the confirmed product text or the brief (in a recreation, from the reference): names, features, numbers, claims, prices, dates, availability, the URL.
- Missing a fact? Ask. Never invent a statistic, customer, feature or UI the product does not have.
- The wording around the facts is yours. Never paste website headings or section labels as captions just because they are true.

### The user's taste
- Latest explicit feedback wins. recallMemory gives a saved style's full recipe; remember saves a new lasting verdict with its scope.
- **Liked:** the isometric line diagram style where structure is the subject: thin white isometric outlines on near-black, hatching on one face, one thin accent edge, dimension ticks, small sans labels.
- **Disliked:** cheap cursors (a cursor appears only to demonstrate an interaction), bright brand-purple fills, sparkles or AI-magic icons, stock-template looks.

### Direction and feedback
- **Exact direction from the user:** do exactly that. Never override the user.
- **Approved work is off-limits:** change it only when the user names it. When the user approves a section, mark it with approveClip.
- **Feedback on one part:** change only that part, with patchScene. Every other section, title, timing, move, color and sound stays exactly as it was.
- Never "improve" what was not asked about. If a change forces something else to shift (later timings, an audio cue), keep it otherwise identical and say what moved.
- **A film the user likes for its style** (not one to copy): readFrames its whole arc.
- For each choice you borrow, note what it does, why it works and how this film expresses it differently. Never reuse its imagery, layout or timing.

## Pages
- `ideation`: the conversation before a new film: message, tension, angles.
- `backgrounds`: the three-layer background built from the brand kit.
- `brand-kit`: find, create and confirm the brand kit; `brand` in scene code.
- `blueprints`: rebuild a product screenshot as live HTML with named parts.
- `image-plates`: when and how to generate image assets (photos, textures, cut-outs).
- `transitions`: motion words mapped to recipe pages.
- `recipe-letter-reveal`, `recipe-write-on`, `recipe-mask-wipe`, `recipe-blur-in`, `recipe-morph`, `recipe-typing`, `recipe-fly-off`: one named transition each.
