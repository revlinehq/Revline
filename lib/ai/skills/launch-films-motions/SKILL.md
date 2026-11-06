---
name: "launch-films-motions"
description: "Sets the motion, timing and style rules for films made from scratch with no footage on screen: launch and feature films, teasers, standalone motion scenes and shot-for-shot copies of a reference. Read it before building, restyling or editing any of them; writing-scenes covers the code."
---
# Launch films and motion

A good film says one true message in the user's brand, moves fast with short beats and quick exits, and changes only what the user asked for. Every fact on screen comes from the user.

Terms: a **film** is the output; a **section** is one `section(...)` call; a **beat** is one idea on screen inside a section (a title, a UI state, a feature); a **move** is one animation; a **reference** is a video being copied.

Contents: Workflow; Defaults (timing and easing); Rules (structure, timing, a new film for the user's brand, a style reference, never speculate, taste, direction and feedback); Before handing back; Example; Pages.

## Workflow
1. **Existing film:** start with writing-scenes page `edit-lanes` and follow it instead of the steps below.
2. **Recreation:** the reference is the brief (no brand kit, no brand questions). Follow remaking-videos page `recreation` instead of steps 3–5.
3. **New film:** read page `ideation`. When the user accepts an angle, start building.
4. **Look:** find or create the brand kit (page `brand-kit`), then build the background (page `backgrounds`) before the first addFilm.
5. **Assets:** page `image-plates` for anything code cannot draw; page `blueprints` when the user's product UI is shown.
6. **Build** the film with addFilm as writing-scenes page `films` describes, timing every move from Defaults.
7. **Check** the film as "Before handing back" lists, then call finish.

## Defaults

### Timing and easing
Defaults for original films. The user's direction and a reference being copied win.

| Move | Duration | Ease | Example |
|---|---|---|---|
| Typical move (anything) | 0.25–0.6 s, aim 0.38 s | | A card sliding 120 px: 0.4 s |
| Entrance | 0.25–0.55 s, aim 0.35 s | `power3.out` (default), `power2.out` | Headline in: 0.35 s power3.out |
| Exit | about 0.8× its entrance: 0.2–0.4 s, aim 0.3 s | `power2.in` | Headline out: 0.28 s power2.in |
| Between two resting spots | 0.35–0.6 s, aim 0.5 s | `power2.inOut` | Panel docking to the sidebar: 0.5 s |
| Camera move (push, pan, pull-back) | 0.8–1.4 s | `power3.inOut` or `power2.inOut` | Push-in to the composer: 1.0 s |
| Typing and UI demos | 2–3× real speed | `none` | A 40–50 character prompt: at most 1 s |
| Beat (one idea on screen) | 1.75–3.5 s, aim 2.45 s | | A title, a UI state, a feature |

## Rules

### Structure
- Length, number of sections and content follow the user's request and brief. There is no default structure and no required proof beat.
- The pacing rules below apply at any length.

### Timing
- Never exit with the entrance's ease or duration, and never with a slow fade.
- **Only the camera runs past 1 s.** A non-camera move over 0.6 s needs a reason (a progress bar, a long draw-on); over 1 s it gets split or sped up. Failing examples: a 1.8 s zoom on a UI element, 1.75 s of typing.
- **Curve mix:** `power3.out` for most moves, then `power2.out` and `power2.in`.
- `back.out` and `expo.out` are rare: at most one or two per film, for one deliberate snap or playful landing, never as the default.
- **A beat over 4 s** needs a second action inside it (a camera move, a new element, a state change), not a held frame.

### A new film for the user's brand
- Use the brand kit's fonts, colors and logo.
- **Product UI only when asked:** rebuild the user's real UI only when they ask to show their product, page or components.
- Otherwise design the film's own UI and objects freely in the brand's fonts and colors.
- Product UI shown in several sections is built once and reused; page `blueprints` says when a shot uses the screenshot and when the blueprint.

### A style reference
- **A film the user likes for its style** (not one to copy): readFrames its whole arc.
- For each choice you borrow, note what it does, why it works and how this film expresses it differently. Never reuse its imagery, layout or timing.

### Never speculate
- Every fact on screen comes from the request, the confirmed product text or the brief (in a recreation, from the reference): names, features, numbers, claims, prices, dates, availability, the URL.
- Missing a fact? Ask. Never invent a statistic, customer, feature or UI the product does not have.
- The wording around the facts is yours. Never paste website headings or section labels as captions just because they are true.

### Taste
- Taste is per user: recallMemory gives their saved styles and verdicts, and remember saves a new lasting verdict with its scope.

### Direction and feedback
- How to take direction and feedback on a film lives in writing-scenes page `edit-lanes` (Direction and feedback).

## Before handing back
Look at these with getFrames:
- the first frame;
- each cut, on the cut;
- one frame per section;
- nothing still on screen after the element that owns it has closed.

finish runs the timing and limit checks on the saved code automatically.

## Example
An 8 s film in three sections: a word-by-word entrance with a faster ease-in exit, one camera push, fast typing, and a last beat that holds.

```js
export default function scene({ root, tl, section }) {
  root.innerHTML = `
    <div class="stage" style="position:absolute;inset:0;background:#F7F5F1;overflow:hidden">
      <div class="cam" style="position:absolute;inset:0">
        <h1 class="title" style="position:absolute;left:160px;top:380px;margin:0;overflow:hidden;font:600 112px/1.25 Inter;color:#16141A">
          <span style="display:inline-block">Edit</span> <span style="display:inline-block">films</span> <span style="display:inline-block">by</span> <span style="display:inline-block">talking.</span>
        </h1>
        <div class="composer" style="position:absolute;left:460px;top:600px;width:1000px;padding:28px 36px;border-radius:24px;background:#FFFFFF;box-shadow:0 18px 40px rgba(20,10,40,.10);font:500 44px Inter;color:#16141A"><span class="typed"></span></div>
      </div>
      <div class="logo" style="position:absolute;inset:0;display:grid;place-items:center;font:700 96px Inter;color:#16141A">Revline</div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const words = root.querySelectorAll('.title span');

  section('Hook', 0, 2.6, (s) => {
    // entrance: 0.35 s power3.out
    s.from(words, { yPercent: 110, duration: 0.35, ease: 'power3.out', stagger: 0.06 }, 0.2)
    // exit: faster (0.28 s ≈ 0.8×) with an ease-in
     .to($('.title'), { y: -30, opacity: 0, duration: 0.28, ease: 'power2.in' }, 2.3);
  });

  section('Prompt', 2.6, 3.2, (s) => {
    // camera push: the only move allowed past 1 s
    s.fromTo($('.cam'), { scale: 1 }, { scale: 1.08, duration: 1.0, ease: 'power3.inOut' }, 0)
     .from($('.composer'), { y: 40, opacity: 0, duration: 0.35, ease: 'power3.out' }, 0.1)
    // typing at 2–3× real speed: 19 characters in 0.8 s
     .to($('.typed'), { text: 'cut the long pauses', duration: 0.8, ease: 'none' }, 0.6)
     .to($('.composer'), { y: -24, opacity: 0, duration: 0.28, ease: 'power2.in' }, 2.9);
  });

  section('End', 5.8, 2.2, (s) => {
    // last beat holds to the end, no exit
    s.from($('.logo'), { y: 30, opacity: 0, duration: 0.35, ease: 'power3.out' }, 0.1);
  });
}
```

## Pages
- `ideation`: the conversation before a new film: message, tension, angles.
- `backgrounds`: the three-layer background built from the brand kit.
- `brand-kit`: find, create and confirm the brand kit; `brand` in scene code.
- `blueprints`: rebuild a product screenshot as live HTML with named parts, and when a shot uses it instead of the screenshot.
- `image-plates`: when and how to generate image assets (photos, textures, cut-outs).
