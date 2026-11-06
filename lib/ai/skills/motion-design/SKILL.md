---
name: "motion-design"
description: "Motion design made from scratch, with no footage on screen: launch and feature films, product and feature reels, teasers, any standalone motion scene, and faithful motion-film copies when requested (shot for shot from their frames, with no brand questions). How films are built (one clip, one timeline, patchScene edits), the recreation method, and the user's rules for facts and feedback; pages for backgrounds (base, structure and accent from the brand kit), the brand kit and blueprints (product UI that moves). Read before any launch, announcement, teaser, feature video or standalone motion scene. Scenes themselves: scene-engine."
---
# Motion design: launch and feature films

For edits to an existing film, start with scene-engine page `edit-lanes` and follow its workflow instead of the build guidance below.

For a new motion film, read page `ideation`: agree one message, one audience tension and 3–5 angles, each with "Hooks because …". The user's "do it" accepts that angle to BUILD immediately. Skip small edits and "just build it". Use page `image-plates` for real scene assets: icons, traced shapes and code come before generation.

Follow the user's request first. A video to recreate goes through "Recreating a video" below; a new film for the user's own brand goes through "A new film" below.

**Background before the first addFilm.** For a new film or a background restyle, read page `backgrounds`: build base, structure and accent from the brand kit, write the one-line choice into the brief, and keep its shadows and limits.


## Length and structure come from the request
Length, number of sections and what the film shows follow the user's request and brief. There is no default structure or required proof beat. When the user gives no length, ask once in the ideation message with a suggestion sized to the content (for example "about 20 s: title, three features, end card"). Pacing rules apply at any length.

## How films are built
A film is one plain GSAP scene clip built with addFilm, its sections written as `section(...)` calls, and changed with patchScene. How to write, split and edit it lives in scene-engine page `films`; this skill decides what the film shows. Split a film into clips only when the user asks.

## Moves and transitions
Named transitions (letter reveal, write-on, mask wipe, blur-in, morph, typing, fly-off) each have a recipe page; page `transitions` maps motion words to them. Their timing follows the table below unless a reference is being copied.

## Timing and easing (measured)
Measured from 151 tweens and 87 shots across the user's saved launch films (rerun, shipper, rightnowai, krea, allophone, juampitech, Deepusleepy, firecrawl ×3). These are defaults for original films; the user's direction and a reference being copied win.

| Move | Duration | Ease | Example |
|---|---|---|---|
| Typical move (anything) | 0.25–0.6 s, aim 0.38 s | | A card sliding 120 px: 0.4 s |
| Entrance | 0.25–0.55 s, aim 0.35 s | `power3.out` (default), `power2.out` | Headline in: 0.35 s power3.out |
| Exit | 0.2–0.4 s, aim 0.3 s | `power2.in` | Headline out: 0.28 s power2.in |
| Between two resting spots | 0.35–0.6 s, aim 0.5 s | `power2.inOut` | Panel docking to the sidebar: 0.5 s |
| Camera move (push, pan, pull-back) | 0.8–1.4 s | `power3.inOut` or `power2.inOut` | Push-in to the composer: 1.0 s |

1. **Exits are always faster than entrances.** An element leaves in about 0.8× its entrance time with an ease-in (enter 0.35 s power3.out → exit 0.28 s power2.in). Never exit with the entrance's ease or duration, and never with a slow fade.
2. **Nothing but the camera runs past 1 s.** A non-camera tween over 0.6 s needs a reason (a progress bar, a long draw-on); over 1 s, split it or speed it up. Example of what fails: a 1.8 s zoom on a UI element, 1.75 s of typing.
3. **Curve mix.** Use `power3.out` for most moves, then `power2.out` and `power2.in`. `back.out` and `expo.out` are each about 3% of measured moves: at most one or two per film, for one deliberate snap or playful landing, never as the default.
4. **Beats are short.** A beat (one idea on screen: a title, a UI state, a feature) lasts 1.75–3.5 s, aim 2.45 s. Over 4 s is rare: a beat that long needs a second action inside it (a camera move, a new element, a state change), not a held frame.
5. **Typing and UI demos run fast.** Type at 2–3× real speed: a prompt of 40–50 characters takes at most 1 s.

## Sound
1. **Music only by default.** A new film gets one music track and no generated sound effects. Add effects with generateSound only when the user asks for them; a few mistimed effects make the film feel stop-start.
2. **The user's track wins.** When the user names or uploads a song, use it (addMedia) and say once that publishing it needs a license. Otherwise suggest a track with matchMusic and let the user hear it before building around it.
3. **Cut on the bar.** markMusicBeats on the track, then put section starts and big moves on bar lines: one bar = 4 × 60 / BPM s (1.88–2.0 s at 120–128 BPM). Beats of 1–2 bars match the 1.75–3.5 s beat length above. Since a film is one clip, move its sections in code to the bar times; never run alignCutsToBeat on it.
4. **Levels.** Music at about -14 LUFS for a film with no speech; under speech, duck it 8–10 dB.

## Recreating a video (clone, remake, copy, "shot for shot")
The video is the brief. New recreations use the recreate lane, which runs full checks. Read reference-footage page `recreation` before building a copy or making a full-lane edit. It owns the workflow: numbered effect inventories, exact content, camera behavior per layer, one section at a time, rendered comparisons across every transition, and close-out against every inventory item. Follow its measured behavior over this skill's motion defaults. Use scene-engine for implementation and its checklist for final checks.

## A new film for the user's own brand
1. **Brand kit for the look:** find or create the brand kit (page `brand-kit`) and use its fonts, colors and logo. Skip the product-text interview unless the film states product facts the user has not given.
2. **Product UI only when asked:** rebuild the user's real product UI (blueprints, kit screens, measureScreen, compareScreen) only when the user asks to show their product, page or components. Otherwise design the film's own UI and objects freely in the brand's fonts and colors. When product UI is shown in several sections, build it once and reuse it. Per shot: when the whole UI moves or holds, use the screenshot (`media.<screen>`); when something inside it moves, it zooms past 2× or its text changes, use the kit's blueprint (page `blueprints` builds a missing one).

## Never speculate
In a new film, every fact on screen comes from what the user wrote or listed in the request, the confirmed product text, or the brief (in a recreation, from the video): names, features, numbers, claims, prices, dates, availability, the URL. Missing? Ask. Never invent a statistic, customer, feature or UI the product does not have. The wording around the facts is yours to write; never paste website headings or section labels as captions just because they are true.

## The user's taste
Saved feedback from this user (latest explicit feedback wins; recallMemory for a saved style's full recipe, remember for a new lasting verdict with its scope):
- Liked: the isometric line diagram style (thin white isometric outlines on near-black, hatching on one face, one thin accent edge, dimension ticks, small sans labels) where structure is the subject.
- Disliked: cheap cursors (a cursor appears only to demonstrate an interaction), bright brand-purple fills, sparkles or AI-magic icons, stock-template looks.

## Direction and feedback
- **Exact direction from the user:** do exactly that. Never override the user.
- **Approved work is off-limits** (how: scene-engine page `films`). When the user approves a section, mark it with approveClip (markerId of its section) and their words as the note; never approve on their behalf.
- **Feedback on one part:** change only that part, with patchScene. Every other section, title, timing, move, color and sound stays exactly as it was; never "improve" what was not asked about. If the change forces something else to shift (later timings, an audio cue), keep it otherwise identical and say what moved.
- **A style reference** (a film or brand they like, not one to recreate): readFrames its whole arc, then note for each choice you borrow: what it does → why it works → how this film expresses it differently. Never reuse its imagery, layout or timing.