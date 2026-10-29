import type { EditorSkillPage } from '../index';


export const STYLE_PAGES: EditorSkillPage[] = [
  {
    name: 'dark-cinematic',
    description: 'Near-black stage, flat front-on UI as the only light; typed prompts in real time, blur reveals and dissolves, long holds, a quiet centered lockup. For serious, precise, developer and AI tools.',
    body: `# Dark cinematic (example direction)

An example of a coherent direction, measured from real films. Start from it, combine it with others, or depart from it when the brand or story calls for it.

Feels: focused, premium, serious.

## Look
- Stage near-black (#000 to #181818) with a vignette. Surfaces #15171a to #262624, 1px borders a step lighter. Text #e3e4e6, muted #6b7076 to #8a8d92.
- Color only from the brand: one accent on small things (a send button, a mention chip, a gradient on the wordmark). Status colors stay tiny.
- No grain. Depth from blur and shadow only.

## Type
- Neutral grotesk (the brand body font). UI text at real UI size; captions ~6% of frame height, 2 to 4 words, centered, alone on black.
- Text enters by typing (10 to 18 chars/s, caret visible) or blur-in (blur 6 to 16px to 0, 0.35 to 0.5s, power2.out). Freshly typed characters may glow in the brand accent, then settle to white over ~0.5s.

## UI
- Real-looking product UI, flat and front-on, large and cropped to the area that matters. The camera barely moves; a thread scrolls or results drop in instead.
- No cursor. Interaction is typing; results land by fading in with a slight blur (0.3 to 0.4s) or scale down from full-bleed into rounded cards on the dark stage (0.8s, expo.out).
- For UI on a tilted 3D plane with focus falloff, use dimensional-ui instead.

## Pacing
- Beats 3 to 8s. Typing plays in real time. Hard cuts between camera setups; no wipes.
- Exit UI with a full-frame blur dissolve (blur 12px plus fade, ~0.7s) before a caption.
- Lockup: centered wordmark blurs in (0.5s), optional accent sweep across letters (~1s), short tagline wipe, then the mark alone held 3 to 4.5s.

## Rules
- Keep everything dark; let UI text carry the light.
- Show the feature by doing it (typing, sending, results landing), never by describing it.
- Hold long enough to read; this style never rushes.
- End quietly: plain centered type, then the mark alone.`,
  },
  {
    name: 'dimensional-ui',
    description: 'The product UI on a tilted 3D plane in near-black space: shallow focus, slow camera drifts cut between setups, typed prompts, rows that decode in, a blur-in wordmark lockup. For flagship launches of serious software where the product itself should feel like an object.',
    body: `# Dimensional UI (example direction)

An example of a coherent direction, measured from real films. Start from it, combine it with others, or depart from it when the brand or story calls for it.

Feels: cinematic, precise, expensive; the software becomes a physical object you fly over.

## Look
- Pure black surround (#000) with a heavy vignette. UI surfaces #15171a to #1e2124, raised panels #24282c, 1px borders ~#2e3236. Text #e8e8e8, muted #6b7076.
- Color only in tiny status icons and one accent on the lockup. No grain.
- Shallow depth of field: only a diagonal band of the plane is sharp; near and far edges fall into blur and darkness.

## The plane
- Build the product UI as one large DOM panel (a full app window: sidebar, document, panels). Make it detailed and real: this style lives on fidelity.
- Wrap it in a parent with perspective ~1800px and tilt it: rotateX ~45 to 55deg, rotateZ ~-12 to -20deg, so it recedes to the upper right.
- Focus falloff: a mask gradient plus a blurred copy behind the sharp band, or blurred overlays at the near and far edges; then a radial vignette to black.

## Camera
- A setup is one framing of the plane: a corner, the composer, a list, a wide view. Each lasts ~3 to 8s.
- Inside a setup the camera always drifts slowly: tween the plane's x, y (and z) by ~5 to 10% of the frame over the whole setup, ease none.
- Change setups with hard cuts to a new plane transform. No wipes, no whip pans. One wide shot shows the whole app small in frame.

## Content
- Interaction is typing in a composer: ~10 to 12 chars/s with a bar caret; a panel grows to make room (~0.6s, power2.out).
- Generated content decodes: each row starts as scrambled glyphs and resolves over ~0.5s, rows stagger ~0.25s, top to bottom. Or blur-to-sharp: blur ~10px to 0 with opacity 0.3 to 1, ~0.8s, power2.out, stagger ~0.3s.
- Diagrams draw in: lines scale from 0 (~0.4s, power2.out), labels brighten from grey to white in sequence.

## Lockup
- Black. Centered wordmark blurs in (blur 16px to 0, 0.5s, power2.out); an accent highlight sweeps across the letters (~1s, ease none); a short tagline wipes in left to right with a feathered mask (~0.7s).
- Then a hard cut to the mark alone, held ~4s.

## Rules
- Never show the UI flat; always on the tilted plane with focus falloff.
- The camera never stops drifting; angles change only with hard cuts.
- Show work by typing and by content decoding in, not by cursors.
- Hold each setup long enough to read (4 to 8s); the pace is even and unhurried.
- Scenes are separate clips: keep the same plane build and tilt in every scene so cuts feel like one continuous world.`,
  },
  {
    name: 'warm-editorial',
    description: 'Warm off-white or white canvas, headlines built in place word by word or letter by letter, real windows with soft shadows, one flat pastel per section, calm 1.5-3s beats. For friendly productivity and workspace products.',
    body: `# Warm editorial (example direction)

An example of a coherent direction, measured from real films. Start from it, combine it with others, or depart from it when the brand or story calls for it.

Feels: calm, clear, friendly, trustworthy.

## Look
- One warm off-white for the film (#F6F5F1) or pure white text cards (#FFFFFF). Feature sections may sit on one flat pastel each (light blue #CFE3F5, peach #F9E7DD, butter #F8E3A8) or a soft diagonal gradient.
- Text near-black #111 to #151515. Color comes from the UI and partner icons, not from type.
- Flat: no grain, no glow. Only a large soft shadow under windows and cards (0 10 to 20px 40 to 60px, 6 to 10% black).

## Type
- Grotesk semibold (~600), slightly tight tracking, ~9 to 10% of frame height, centered, 2 balanced lines, 3 to 7 words, sentence case.
- Build in place, never slide: words pop on 0.08 to 0.12s apart (near-instant opacity), or letters rise ~0.3em into place (0.12s each, stagger 0.03 to 0.05s, power2.out). Or line by line with a small fade-up (~1.5% height, 0.3s).
- Exit by hard cut. Never put a headline over UI.
- Optional: a handwritten note with a drawn arrow pointing at a key word.

## UI
- Real windows with chrome, or one simplified component centered on a pastel stage. One idea per shot.
- Enter a window with a fade-up (y 2%, 0.6s, power2.out), then a quick camera push to the detail (scale ~1.6, 0.45s, power3.inOut).
- "Works everywhere": stack windows like a deck (current one recedes to scale 0.65, y -30%, the new one lands in front).
- Lists grow by inserting rows (existing rows slide down 0.3s, new row fades in).

## Pacing
- Alternate text card, UI shot, text card. Beats 1.5 to 2.5s, UI demos up to ~5s.
- Before the lockup, a fast roll-call of feature names is allowed (0.4 to 0.6s each).
- Lockup on the same canvas: mark alone ~1s, then wordmark beside it, hold ~2s, cut to black. A left-aligned URL card is a good alternative.

## Rules
- One background color family for the whole film.
- Text and UI never share a frame.
- Motion is gentle and short; holds do the work.`,
  },
  {
    name: 'bold-graphic',
    description: 'Flat saturated color fields and black title cards, words cut on hard with a yellow flash, magnified UI with a giant cursor, 1-2s cuts, stepped or glitchy motion, logo built from shapes. For design tools, consumer and crypto brands, event keynotes.',
    body: `# Bold graphic (example direction)

An example of a coherent direction, measured from real films. Start from it, combine it with others, or depart from it when the brand or story calls for it.

Feels: energetic, crafted, playful, loud.

## Look
- Black (#000) title cards between demo stages. Each feature owns one flat saturated background (lime, purple, orange, slate blue, forest) or a textured backdrop (painted grain, scanlined navy glass).
- One accent that recurs everywhere (lime, brand blue, orange).
- Texture is welcome here: dim flickering code text behind titles, scanlines, grain on painted backdrops.

## Type
- Grotesk at ~10 to 16% of frame height, tight tracking, 1 to 3 words per line, centered or left-of-center stacks.
- Text never fades or slides: it cuts on by word or line. The newest piece flashes in the accent (e.g. yellow #EEF266) for ~0.2s, then settles to white.
- Display alternatives: dot-matrix or pixel letters assembling in random order; condensed heavy display words.

## UI
- Magnify real UI so one control fills 60 to 70% of the frame. A big cursor (black fill, white stroke) or named multiplayer cursors drive it; cursors drifting on loops are ambient motion.
- Bridge sections with zoom-outs that reveal context (scale ~3 to 1, 0.8s, expo.out); push in with power2.inOut.
- Explain systems by building: cards inserted one by one into a row while a label changes word by word; placeholder, wireframe, final UI.

## Motion
- Optionally quantize motion to 12 fps for a hand-made, stepped feel (snap time to 1/12s).
- Limited animation for characters: pose swaps every ~0.2s, one-frame color flickers, blinks over 3 frames.
- Endings: a glitch (characters swapped for symbols, colored highlights, cuts every frame for ~0.8s) or colored primitives converging into the logo (~1.2s), then the logo held 2 to 2.5s on black.

## Pacing
- Cuts every 1 to 2s on titles; demos 3 to 10s with internal zooms. Bursts of very fast cuts mark transitions and the finale.

## Rules
- Alternate black title cards with bright UI stages; never type over UI.
- Every section gets its own color; cut hard between them.
- Energy comes from cuts, flashes and builds, not from smooth tweens.`,
  },
  {
    name: 'crisp-demo',
    description: 'White or light canvas, product first with few or no titles, instant component swaps, snappy cursor-following zooms or a fixed recording, beats of 3.5s or less. For data, API, agent and dashboard products where the working product is the pitch.',
    body: `# Crisp demo (example direction)

An example of a coherent direction, measured from real films. Start from it, combine it with others, or depart from it when the brand or story calls for it.

Feels: fast, practical, confident: "here it is working".

## Look
- White #fff or warm light grey (#f7f6f2 to #E7E5E0). One accent color (e.g. the brand orange) for the product name and key UI. Text #151515.
- Product as white cards or a floating window with one big soft shadow. No chrome needed. A faint grid with corner ticks can frame the hero element.

## Type
- Few titles, or none at all. When used: grotesk medium, ~8 to 9% of frame height, centered, 2 lines; the product name in the accent.
- Words build grey to ink (#cfcfcf to #151515, 0.2s each, stagger ~0.13s).
- Status text shimmers (gradient sweep on the text, ~1s, linear) while work happens.

## UI
- Three working modes:
  - Swaps: components replace each other instantly; small drifts and pops (back.out(1.7), 0.2s) carry the energy.
  - Snap zooms: wide for a split second, then 0.3 to 0.4s zooms to ~2x following the action (power3.inOut, blur peaking mid-move), then still holds of 1 to 4s.
  - Fixed: the camera never moves; the screen fills up as panels, rows and an agent log appear, and a side drawer opens every ~6 to 8s.
- Typing in inputs and a self-typing agent log (mono, ~30 chars/s) tell the story.
- A logo wall that punches in (scale 0.35 to 1, expo.out) and isolates one element is a strong way to name a launch among integrations.

## Pacing
- Every beat 3.5s or less. No long holds except the final state.
- End on the finished product, a pull-back to the window, or the mark plus wordmark on the same light canvas.

## Rules
- The working product is the pitch; cut everything that is not it.
- One accent color only.
- Move fast between holds; hold still while something happens.`,
  },
];

export const TECHNIQUES: EditorSkillPage = {
    name: 'techniques',
    description: 'Feedback and direction mapped to concrete techniques with their timings and eases, measured from real launch films. Use when the user says what feels wrong or what they want more of.',
    body: `# Techniques by feedback

Find the user's words, pick the technique that fits the story, and build it in the brand's fonts and colors. Times are in seconds; adjust them to the beat, never past the craft rules. Tell the user which technique you used so they can accept or refuse it.

## "More premium", "calmer", "more expensive"
- Longer holds (3 to 8s), fewer moves, still frames while the UI works.
- Blur dissolve between UI and caption: the UI layer goes to blur(12px) and opacity 0 over 0.7s, then the caption fades in from blur(6px) over 0.35s.
- Generous empty space, one accent, no grain.
- Quiet lockup: centered mark and wordmark fade in over 0.25s and hold ~4s; or the mark alone at ~6% of frame height for ~1s, then the wordmark beside it, hold ~2s, cut to black.

## "More energy", "snappier", "faster"
- Cut titles every 1 to 2s. Accent-settle reveal with no tweens, only tl.set steps: line 1 appears in the accent; 0.17 to 0.25s later it turns to the text color and line 2 appears in the accent; then all settle.
- Snap zoom to the action: a camera wrapper tweens to scale ~2 on the focus rect over 0.3s, power3.inOut, with blur 0 to 6px to 0 peaking mid-tween as motion blur; then hold still while the UI acts. Several focus rects keyed to times make a cursor-follow reframe (0.35s, power2.inOut each).
- Instant component swaps with small pops (back.out(1.7), 0.2s) instead of long tweens.
- Roll-call before the lockup: 5 or 6 one-line feature names, hard-cut every 0.4 to 0.6s, the last held ~1s with a slow 4% scale-down.

## "More depth", "more 3D", "feels flat"
- Tilted UI plane: build the UI as one large panel in a parent with perspective 1800px, rotateX(48deg) rotateZ(-16deg). Mask a blurred copy to the near and far edges so only a diagonal band is sharp, with a radial vignette to the background. Drift the plane 5 to 10% of the frame over each shot, ease none, and hard-cut to a new transform for the next setup.
- Window deck: when the next window arrives, the current one tweens to scale 0.65, yPercent -32 over 0.6s, power2.out, and stays peeking above; the new window fades in at full size on top.
- Capability drum: 4 or 5 chips on a rotateX cylinder (perspective 800px), stepping one item every ~0.35s, power3.inOut; inactive chips at opacity 0.4, scale 0.85.

## "Text is boring", "headlines feel static"
- Rising letters: split into chars, from yPercent 35 and opacity 0, 0.12s each, power2.out, stagger 0.04. Two centered lines, then hold 1 to 1.5s and hard-cut.
- In-place word pop: every word in a span at opacity 0, tl.to(words, { opacity: 1, duration: 0.03, stagger: 0.1, ease: 'none' }), hold 1.5s, hard cut.
- Muted-to-ink reveal: word spans start in a light grey at opacity 0, then go to opacity 1 and the text color (the product name in the accent), 0.2s each, stagger 0.13.
- Typed text with a glowing tail: ~18 characters per second, the newest ~6 characters in the accent fading to the text color over 0.5s, the camera following the caret.
- Dot-matrix letters: each letter on a 5x7 grid of small squares, letters revealed in shuffled order (or dots flying in from random offsets) over 0.4 to 0.6s.
- Blur-then-sweep: the word goes from blur(16px) and opacity 0 to sharp over 0.5s, power2.out, then a gradient sweeps across it (background-clip text, background-position -100% to 200% over ~1s, ease none).

## "Transitions feel cheap", "cuts are jarring"
- Morph one object into the next: a stack of chips collapses into a small card that grows into the window (~1.4s, power2.out) while its headline types.
- Zoom-out bridge: start on a full-bleed detail and scale the container from ~3 to 1 over 0.8s, expo.out, to reveal where it lives; cut on landing.
- Output drop-in: cut to the result full-bleed at scale 1.15 with a tinted overlay, then tween to scale 0.85 with 24px corners and the overlay gone over 0.8s, expo.out; a slow 1.0 to 1.03 push during the hold.
- Hard cuts between drifting camera setups, never wipes.
- Layout changes by moving elements, no cut: icons tween from a scatter to a grid in 0.3s, power3.out, with 0 to 0.05s random delays; hide the headline on the frame they converge and show it on the frame they part, so they seem to cover it.

## "The UI looks fake", "show the product better"
- Macro UI: one component at 60 to 70% of the frame width on a flat color, driven by a big cursor (black fill, 3px white stroke).
- Window fade-up then push: the window enters from opacity 0, yPercent 2 over 0.6s, power2.out, then the stage scales to ~1.6 toward the detail over 0.45s, power3.inOut.
- Dense real UI that fills up as work happens: new columns snap in by layout change with no tween; a drawer slides in from x 100% over 0.13s, expo.out, with a 0.7 overlay, and exits over 0.15s, power2.in.
- One simplified component centered on a flat pastel, entering from scale 0.8 over 0.5s, power3.out, then typed into.
- Rows decode in: each row starts as random glyphs that swap to the final characters over ~0.5s, rows staggered 0.25s.
- Row insert proof: existing rows move down one row height over 0.3s, power2.out, the new row fades in on top, then a quick push onto it.

## "Show the AI working", "show it's agentic"
- Real-time composer: step a character index at ~13 characters per second with a blinking caret; a mention turns into a chip once complete. On send the composer fades in 0.1s and the message mounts with its parts staggered 0.05s (opacity, y 4px).
- Scrolling thread: on each new message the column moves up by its height over 0.4s, power2.out, while the message fades in from blur(4px).
- Progress card: a rounded card with a status line that swaps every ~1.7s and a 2px bar filling linearly over the whole sequence, under a very slow camera push.
- Agent log: a dark strip of monospace lines, one appended every 0.4 to 0.8s, typed at ~30 characters per second with steps(), the newest line at the bottom, a blinking caret.
- Working shimmer: the status word has a moving grey gradient (background-clip text, background-position over 1s, repeating) while result chips append below, staggered 0.2s.
- Placeholder to wireframe to UI: panels start as grey sheen blocks, crossfade to thin outline boxes at +0.3s and to the real UI at +0.6s, staggered ~0.3s per panel.

## "Show integrations", "works with everything"
- Logo wall punch-in: a large grid of logo-and-name chips scales 0.35 to 1 over 0.6s, expo.out; the hero chip pops into one slot (back.out(1.4)) and every other chip fades out over 0.3s.
- Ring to grid: partner icons drift 5 to 10px toward the center over 2s (sine.inOut), then snap from a scattered ring into a grid around the headline (0.3s, power3.out).
- Windows of each app stack as a deck (see "More depth").

## "The ending is weak", "the logo needs more"
- Wordmark blurs in, an accent gradient sweeps across it, the tagline wipes in with a soft mask (~15% feather, left to right over ~0.7s, power1.inOut), then the mark alone.
- Glitch: for ~0.8s random characters swap to symbols like <>/{}#, then colored blocks gather and scale into the mark over ~0.5s; cut to the clean logo and hold 2.5s.
- Shapes converge: 5 colored circles or pills drift and converge into the mark over ~1.2s, then hold.
- Pixel blocks: a bar splits into blocks matching the letter widths, each swaps to its real letter with a one-frame flash, then the mark pops.
- URL card: small title line, big URL, the mark far right on the same band, built in 3 steps ~0.5s apart, held ~1.7s, then black.

## "Too busy", "too much going on"
- One idea per shot; never text over UI.
- Hold still while one thing happens.
- Remove motion that does not show a relationship, an action or a hierarchy.

## "More playful", "more personality"
- A mascot made from the logo shape: pose swaps every 0.2s, blinks by scaling the eye height to 0.1 for 3 frames, pops with back.out(1.7).
- Handwritten notes with drawn arrows on a headline: the note rotated about -5deg, the arrow path drawn over ~0.3s.
- Named cursors with colored name pills drifting on slow loops (3 to 4s, sine.inOut) as ambient motion.
- Stepped 12 fps motion for a hand-made feel: ease 'steps(n)' or snap times to 1/12s.`,
  };
