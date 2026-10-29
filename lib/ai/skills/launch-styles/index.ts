import type { EditorSkill, EditorSkillPage } from '../index';
import { STYLE_CARDS } from './cards';

const cardsFor = (style: string) => STYLE_CARDS.filter(card => card.style === style).map(card => `\`${card.name}\` (${card.description.split('. ')[0]})`).join(', ');

const styles: EditorSkillPage[] = [
  {
    name: 'dark-cinematic',
    description: 'Near-black stage, flat front-on UI as the only light; typed prompts in real time, blur reveals and dissolves, long holds, a quiet centered lockup. For serious, precise, developer and AI tools.',
    body: `# Dark cinematic

Feels: focused, premium, serious. Cards: ${cardsFor('dark-cinematic')}.

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
    body: `# Dimensional UI

Feels: cinematic, precise, expensive; the software becomes a physical object you fly over. Card: ${cardsFor('dimensional-ui')} (read it for exact timings).

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
    body: `# Warm editorial

Feels: calm, clear, friendly, trustworthy. Cards: ${cardsFor('warm-editorial')}.

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
    body: `# Bold graphic

Feels: energetic, crafted, playful, loud. Cards: ${cardsFor('bold-graphic')}.

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
    body: `# Crisp demo

Feels: fast, practical, confident: "here it is working". Cards: ${cardsFor('crisp-demo')}.

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

export const launchStyles: EditorSkill = {
  name: 'launch-styles',
  description: 'Pick and apply a visual style for a launch or feature film, from a library built by analysing 14 recent launch films frame by frame (Linear, Notion, Figma, ElevenLabs, Firecrawl, Base, Motion, Okara). Read after launch-films, before the beat sheet. Pages hold each of the five styles and each film\'s card.',
  body: `# Launch styles

Styles come from measured launch films, not taste. Each style page gives look, type, UI treatment, motion and pacing; each card page describes one real film in detail, with durations and eases.

## Choosing
1. User named a reference film or brand: use the matching card page (or the closest one) and its style page.
2. Otherwise match the confirmed brand tone and product:
   - Serious, precise, developer or AI tool, dark brand: \`dark-cinematic\` (flat UI, feature films) or \`dimensional-ui\` (UI as a tilted 3D object, flagship launches).
   - Friendly workspace or productivity, light brand: \`warm-editorial\`.
   - Design, creative, consumer, crypto, keynote energy: \`bold-graphic\`.
   - API, data, agents, dashboards, "see it work": \`crisp-demo\`.
3. Say which style you picked and why in one line in the beat sheet. The brand kit's fonts and colors replace the style's example values; the style decides structure, motion and pacing.
4. Read the style page, then one or two of its cards for exact durations and eases.

## What all 14 films share
- One idea per shot. Headlines and UI almost never share a frame.
- Type builds in place (word or letter reveals, typing, blur-in). It rarely slides across the screen.
- Interaction is shown by typing in real time far more often than by a cursor.
- Show the real product UI, cropped and magnified to the part that matters. No floating generic shapes standing in for the product.
- One accent color. Status colors stay small.
- The lockup is held: 2 to 4.5s on a calm frame, often the mark alone at the very end.
- Cuts rarely land on musical beats (measured 0 to 30% of cuts). Music sets energy; the story sets the cuts. Put sound hits on reveals, not every cut.
- Still holds are normal while something happens in the UI; a slow drift is optional, not required.

## Do not copy
Use a card for style only: never its copy, product, logo, characters or exact compositions.`,
  pages: [...styles, ...STYLE_CARDS.map(({ style: _style, ...card }) => card)],
};
