import type { EditorSkill } from './index';

export const imageDirection: EditorSkill = {
  name: 'image-direction',
  description: 'Art-direct EVERY generateImage call: concrete briefs, hand-drawn storyboard preset, final-look style frames and asset plates; inspect and reject stock-template slop before showing it.',
  body: `# Image direction

Read before EVERY generateImage call. Honor the user's style, brand kit and references. Without them, choose a look that serves the concept; at sketching time state "Look: …, because …" and let the user override it. Never turn missing style into another selection task. The storyboard skill owns text-first ideation and approval stops; motion-design page image-plates owns asset selection and GSAP binding.

## Write a brief, not adjectives
Every prompt specifies: (1) medium/format, (2) ONE reference era or discipline, (3) composition and framing, (4) lighting, (5) 2–4 named colors, (6) texture/grain and (7) what is excluded. Name a subject and a purpose. "Premium, cinematic, stunning, futuristic" makes none of these decisions. For cut-outs request a complete silhouette, generous margins and no floor/backdrop; set transparentBackground: true. Assets without lettering say "no text, no lettering, no logos". Storyboard labels stay minimal; final on-screen text is saved separately and built as type.

## Rough storyboard preset
Pencil or fineliner line work on off-white paper, loose construction lines, light grey marker shading, at most ONE accent marker (for example muted red or green). Visible hand-drawn panel border; shot number in a corner. Show movement with hand-drawn arrows and speed lines, a camera-move arrow for a push/pan, and small IN/OUT notes. Few short handwritten labels: the model misspells. Same paper, pen and hand across every frame: pass rough frame 1 as a reference for the rest. Never polished, never 3D-rendered, never glowing. This deliberately rough stage shows composition and flow, not a fake finished film.

Style frames use the chosen FINAL look, anchored on the first style frame. Asset plates are photoreal or illustrated as the brief specifies. Two concepts must differ in story and composition, not just their palette.

Hand-drawn is also a buildable FINAL look, proven in the Terra motion study DfMzGyNBdUH (repository notes/motion-studies/DfMzGyNBdUH.md). Build it with SVG stroke-draw lines (DrawSVG or stroke-dashoffset on the scene's GSAP clock), a fixed paper texture and separate hand-drawn image plates animated as layers. Read gsap page revline and scene-engine react-scenes/checklist. Keep actual type editable; do not flatten the film into generated frames. The rough-board preset's border and arrows are planning marks, not mandatory finished-film decoration.

## Banned by default
Allow an item only when the user explicitly asks for it: neon/glow lines, glassmorphism, purple-to-lime or purple/blue gradients, floating 3D UI cards, lens flares, bokeh orbs, sparkles, holograms, generic smiling stock people, sunset-mountain hero shots, "futuristic" anything, AI-looking skin. Replace them with specific physical materials, deliberate negative space, controlled light and the subject the story actually needs.

Anchor in the user's verdicts: liked isometric line-diagram blueprints and muted film-grain gradients; disliked bright purple fills, sparkles and cheap cursors. These are defaults, not permission to ignore an explicit new direction.

## Self-check before showing
Look at each actual returned image. Does it follow the brief, stay buildable, convey this shot and avoid every unrequested banned item? Does it read as a specific idea rather than a stock template? Reject a failure and regenerate ONCE with a sharper brief naming the correction. If that still fails, report the concrete issue and ask for direction instead of passing it off as approved. For storyboards call presentStoryboard only for inspected, accepted frames; the composer grid hides candidates until then. This review is YOUR quality check; the user's stage approval still follows. Asset previews likewise need inspection before using them in a scene. Keep estimatedUsd/usage visible when reporting generation cost.

## Bad → good briefs
- Bad: "Cinematic futuristic startup storyboard, purple neon." Good: "Rough pencil storyboard, architectural concept-sketch discipline. Wide frame: message scraps crowd the left; one clear route opens to the right. Flat desk light; off-white, graphite, light grey, one muted green marker. Paper tooth and loose construction lines; hand-drawn border, shot 2, rightward arrows, small IN/OUT. No polished render, glow, glass panels, people or decorative UI."
- Bad: "Premium computer with dramatic effects." Good: "Studio product photograph, 1980s industrial-design catalogue. One beige CRT and keyboard, three-quarter front view, complete silhouette with generous margins. Large softbox above left; ivory, charcoal, warm grey. Matte aged plastic and fine 35mm grain. Blank screen, no text, logos, flares, glowing accents or extra objects."
- Bad: "Woman holding a card, beautiful skin, sunset." Good: "35mm studio close-up, documentary still-life discipline. One adult hand holds a blank card, wrist entering below, all fingers and card inside frame. Broad soft side light; natural umber, ivory, warm grey. Real skin creases and subtle film grain. Transparent cut-out, no floor, scenery, face, lettering, jewelry or beauty retouching."
`,
};
