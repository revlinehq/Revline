---
name: "backgrounds"
description: "Read before the first addFilm of a new film and before restyling a film's background: the three-layer background recipe (base, structure, accent) with colors derived from the brand kit, shadow values, banned looks and the measured check."
---
# Backgrounds: build one per film from three layers

A film background is built, not picked from a preset. Choose one option per layer, derive every color from the brand kit, and give each layer a job in the motion. The user's explicit direction and a measured recreation override this page; the limits below still apply to whatever they ask for unless they explicitly override a limit too.

Write the choice down before the first addFilm, in one line, for example: "Base warm paper #F7F5F1, structure none, accent bloom #DDD3F7 behind each headline, end card dark #07060B with corner glows." Save it with updateBrief so later edits keep it.

## Colors come from the brand kit
Read the kit with getBrandKit. `mix(a, b, t)` below is a straight sRGB mix: t = 0 is a, t = 1 is b.

| Role | Rule | Revline kit example |
|---|---|---|
| Base | Kit background when it is light (every channel ≥ #E8). A dark kit background is the product's UI color, not the film canvas: use warm paper #F7F5F1 | #F7F5F1 (kit background #0B0C0E is dark) |
| Ink | Kit foreground when it is dark (every channel ≤ #30), otherwise #16141A | #16141A |
| Accent | Kit accent, unchanged | #7C3AED |
| Bloom | mix(base, accent, 0.18–0.22) | ≈ #DDD3F7 |
| Tinted canvas | mix(#FFFFFF, accent, 0.10–0.14), then pull 4% toward grey | ≈ #E7E3F4 |
| Grid lines / dots | base darkened 6–8% (lines), 12–15% (dots) | #ECECEC lines, #D9D9D9 dots |
| Accent word | Accent darkened 8–12% when it sits on a light base | #6D3FD0 |

With no brand kit, use the example column. When the user asks for a color ("make it orange", "go dark"), replace only that role and recompute the roles derived from it; keep every limit below.

## Layer 1: base canvas (exactly one)
| Base | Value | Use it for |
|---|---|---|
| Warm paper | #F7F5F1 | Default for launch and feature films |
| Cool white | #F7F8FD | Technical subjects, product UI heavy films |
| Clean white | #FFFFFF or #FCFEFB | Colorful footage, photos or tiles carry the color |
| Tinted canvas | ≈ #E7E3F4 (from the formula) | One calm on-brand beat or a whole quiet film |
| Dark | #07060B | The end card, or ONE punch beat; never the body of the film |

The body of a launch film is light. Measured across the saved launch films (rerun, krea, allophone, firecrawl, shipper, juampitech): every one uses a base between #F7F5F1 and #FFFFFF with near-black ink and one saturated accent. The dark product UI (blueprint colors) sits ON the light base as an object.

## Layer 2: structure (zero or one)
- **Cell grid:** 1 px lines every 48–96 px in the grid-line color. Put a headline on a cell-aligned box filled with the base color so it reads as one cell.
- **Crosshair marks (with the cell grid):** 12 px "+" marks, 1.5 px stroke in the accent, on the four corners of the focal box. They track the box when it moves.
- **Dot grid:** 2 px dots every 24 px in the dot color. Quieter than lines; good under dense UI.
- **Perspective floor:** the cell grid rotated about 60–65° on X from the bottom edge, masked to fade out by 60% of the frame height. Use when the camera travels.
- **Cool grid + bloom:** cool white base, lines mix(base, #000, 0.06), plus the bloom accent. Counts as structure + accent.

Grid contrast stays under 8% against the base (measureFrame both colors). A grid that reads as a pattern from across the room is too strong.

## Layer 3: accent (zero or one)
- **Bloom:** ONE radial glow, at most 42% × 55% of the frame, center on the focal point: `radial-gradient(42% 55% at X Y, BLOOM 0%, BLOOM@55% 40%, transparent 75%)` over the base. It follows the focal point between sections with the same ease as the camera.
- **Pixel field:** square cells 8–16 px with 2 px gaps in the accent at 10–100% opacity, from a seeded hash (never Math.random at render time). Use it to BUILD things: cells fill the area where a panel or word will appear, staggered 3–5 ms per cell, then the real element resolves over them and the cells fade out within 0.4 s.
- **Pixel bleed:** the pixel field spilling across a grid from one corner or edge, densest at the edge and gone by 45% of the frame.
- **Lit cells:** whole grid cells filled mix(base, accent, 0.08); one may use 0.16. They switch on with the beat, like a step sequencer.

The accent color appears in one layer plus at most one word per line of text.

## Every layer does a job
- A grid builds itself, carries the focal box, or gives the camera something to travel over. A bloom follows the subject. Pixels build the next element. Lit cells mark the beat. A layer that only sits there is removed.
- Change the background at most once per act (hook, proof, payoff), never per shot. Carry layers through a transition (the grid scrolls, the bloom slides) instead of crossfading two backgrounds.

## Shadows
- Cards, tiles and windows on a light base: `0 18px 40px rgba(20,10,40,.10), 0 2px 6px rgba(0,0,0,.06)`.
- A lifted or selected element may go to `0 24px 56px rgba(20,10,40,.14)`; nothing darker.
- No shadows on text over a light base. Dark UI objects use the same soft shadow, not a black halo.

## Banned
- Full-frame mesh or multi-stop gradients, film grain on a dark canvas, a dark body for a launch film (rejected 2026-11-05: "background is terrible").
- Neon, glowing orbs, blue-tinted darks (#1D202A style), heavy black drop shadows.
- A solid fill in the bright brand accent on a card, pill or the whole frame.

## Check before handback
getFrames on two body beats and the end card, then measureFrame the base in an empty corner of each. Fail and fix when:
- a body beat's base is darker than #E0E0E0 (unless the user asked for dark),
- grid or dot contrast against the base is above 8%,
- the accent color covers more than about 15% of a frame outside a pixel build in progress.

## Calibration: the user's ratings (2026-11-05)
Evidence of taste, not templates. Build new combinations from the layers.
- Very good: warm paper + bloom; cool flat white; white cell grid with the headline on a cell; dark end card #07060B with corner accent glows and a 10 px white dot grid at 8%.
- Good: grid + accent crosshairs; flat tinted canvas; paper with a pixel dissolve at the edges; rising pixel bars from the bottom edge.
- Not bad: pixel field behind a pill headline; dot grid; perspective floor; grid + pixel bleed; cool grid + bloom.
- Rejected: dark film-grain gradients (warm grain, graphite, plum, sage, ash, sand, clay, mesh blends) as film bodies: muddy and unlike every saved launch film.
