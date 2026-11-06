---
name: "backgrounds"
description: "Builds a film background from three layers (base, structure, accent) with colors derived from the brand kit, plus shadow values, banned looks and the measured check. Read before the first addFilm of a new film and before restyling a film's background."
---
# Backgrounds

A good background is light, quiet and built for this film: one base, at most one structure and one accent, every color derived from the brand kit, and every layer doing a job in the motion.

The user's explicit direction and a measured recreation override this page. The limits under Rules still apply unless the user explicitly overrides a limit too.

Contents: Workflow; Defaults (colors, base, structure, accent, shadows); Rules (color, every layer does a job, shadows, banned, check before handback); Calibration.

## Workflow
1. Read the kit with getBrandKit and derive the colors (Defaults, Colors). With no kit, use the example column.
2. Choose one base, then zero or one structure, then zero or one accent.
3. Write the choice in one line and save it with updateBrief before the first addFilm, for example: "Base warm paper #F7F5F1, structure none, accent bloom #DDD3F7 behind each headline, end card dark #07060B with corner glows."
4. Build it, then run the check under Rules before handing back.

## Defaults

### Colors
`mix(a, b, t)` is a straight sRGB mix: t = 0 is a, t = 1 is b.

| Role | Rule | Revline kit example |
|---|---|---|
| Base | Kit background when it is light (every channel ≥ #E8); otherwise warm paper #F7F5F1 | #F7F5F1 (kit background #0B0C0E is dark) |
| Ink | Kit foreground when it is dark (every channel ≤ #30), otherwise #16141A | #16141A |
| Accent | Kit accent, unchanged | #7C3AED |
| Bloom | mix(base, accent, 0.18–0.22) | ≈ #DDD3F7 |
| Tinted canvas | mix(#FFFFFF, accent, 0.10–0.14), then pull 4% toward grey | ≈ #E7E3F4 |
| Grid lines / dots | base darkened 6–8% (lines), 12–15% (dots) | #ECECEC lines, #D9D9D9 dots |
| Accent word | Accent darkened 8–12% on a light base | #6D3FD0 |

### Layer 1: base (exactly one)
Use warm paper #F7F5F1. Switch only when a row below fits better.

| Base | Value | Use instead when |
|---|---|---|
| Cool white | #F7F8FD | The subject is technical or the film is heavy on product UI |
| Clean white | #FFFFFF or #FCFEFB | Colorful footage, photos or tiles carry the color |
| Tinted canvas | ≈ #E7E3F4 (formula above) | One calm on-brand beat, or a whole quiet film |
| Dark | #07060B | The end card, or one punch beat |

### Layer 2: structure (zero or one)
Use none. Add one when the motion needs something to build on or travel over.

| Structure | Spec | Use when |
|---|---|---|
| Cell grid | 1 px lines every 48–96 px in the grid-line color | A headline should sit on a cell-aligned box filled with the base color |
| Crosshair marks (with the cell grid) | 12 px "+" marks, 1.5 px stroke in the accent, on the four corners of the focal box | The focal box moves; the marks track it |
| Dot grid | 2 px dots every 24 px in the dot color | The section has dense UI |
| Perspective floor | Cell grid rotated about 60–65° on X from the bottom edge, masked out by 60% of frame height | The camera travels |
| Cool grid + bloom | Cool white base, lines mix(base, #000, 0.06), plus the bloom | Counts as structure and accent together |

### Layer 3: accent (zero or one)
Use none, or a bloom when the focal point needs lifting. Switch to another row when the accent should build or mark something.

| Accent | Spec | Use instead when |
|---|---|---|
| Bloom | One radial glow, at most 42% × 55% of the frame, centered on the focal point: `radial-gradient(42% 55% at X Y, BLOOM 0%, BLOOM@55% 40%, transparent 75%)` over the base | (default) |
| Pixel field | Square cells 8–16 px, 2 px gaps, accent at 10–100% opacity, from a seeded hash | Cells should build the next panel or word |
| Pixel bleed | The pixel field spilling across a grid from one corner or edge, gone by 45% of the frame | A grid needs one lively edge |
| Lit cells | Whole grid cells filled mix(base, accent, 0.08); one may use 0.16 | Cells should mark the beat, like a step sequencer |

### Shadows
| Element | Shadow |
|---|---|
| Card, tile or window on a light base (dark UI objects too) | `0 18px 40px rgba(20,10,40,.10), 0 2px 6px rgba(0,0,0,.06)` |
| Lifted or selected element (the darkest allowed) | `0 24px 56px rgba(20,10,40,.14)` |

## Rules

### Color
- A dark kit background is the product's UI color, not the film canvas.
- When the user asks for a color ("make it orange", "go dark"), replace only that role and recompute the roles derived from it; keep every limit.
- The body of a launch film is light: a base between #F7F5F1 and #FFFFFF, near-black ink and one saturated accent.
- Dark is for the end card or one punch beat, never the body. Dark product UI sits on the light base as an object.
- The accent color appears in one layer, plus at most one word per line of text.
- Grid contrast stays under 8% against the base (measureFrame both colors). A grid that reads as a pattern from across the room is too strong.

### Every layer does a job
- A grid builds itself, carries the focal box, or gives the camera something to travel over.
- A bloom follows the focal point between sections, with the same ease as the camera.
- A pixel field builds things: cells fill the area where a panel or word will appear, staggered 3–5 ms per cell; the real element resolves over them and the cells fade out within 0.4 s.
- Lit cells switch on with the beat.
- A layer that only sits there is removed.
- Change the background at most once per act (opening, middle, end card), never per beat.
- Carry layers through a transition (the grid scrolls, the bloom slides) instead of crossfading two backgrounds.

### Shadows
- No shadows on text over a light base.
- Dark UI objects use the soft card shadow, never a black halo.

### Banned
- Full-frame mesh or multi-stop gradients.
- Film grain on a dark canvas, or a dark body for a launch film.
- Neon, glowing orbs, blue-tinted darks (#1D202A style), heavy black drop shadows.
- A solid fill in the bright brand accent on a card, pill or the whole frame.

### Check before handback
getFrames on two body beats and the end card, then measureFrame the base in an empty corner of each. Fail and fix when:
- a body beat's base is darker than #E0E0E0 (unless the user asked for dark),
- grid or dot contrast against the base is above 8%,
- the accent covers more than about 15% of a frame outside a pixel build in progress.

## Calibration: the user's ratings (2026-11-05)
Evidence of taste, not templates. Build new combinations from the layers.
- Very good: warm paper + bloom; cool flat white; white cell grid with the headline on a cell; dark end card #07060B with corner accent glows and a 10 px white dot grid at 8%.
- Good: grid + accent crosshairs; flat tinted canvas; paper with a pixel dissolve at the edges; rising pixel bars from the bottom edge.
- Not bad: pixel field behind a pill headline; dot grid; perspective floor; grid + pixel bleed; cool grid + bloom.
- Rejected: dark film-grain gradients (warm grain, graphite, plum, sage, ash, sand, clay, mesh blends) as film bodies: muddy and unlike every saved launch film. A dark-bodied launch film was rejected with "background is terrible".
- Measured: every saved launch film (rerun, krea, allophone, firecrawl, shipper, juampitech) uses a base between #F7F5F1 and #FFFFFF with near-black ink and one saturated accent.
