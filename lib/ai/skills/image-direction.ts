import type { EditorSkill } from './index';

export const imageDirection: EditorSkill = {
  name: 'image-direction',
  description: 'Before every generateImage call: brief the medium, composition, lighting, real palette/type, texture and exclusions; storyboard panels are colored motion-design style frames matching the final film.',
  body: `# Image direction

## Every image call
1. Read this skill before generateImage. Read the brief and getBrandKit for the actual palette, typefaces and real product screens. If none is supplied, choose 2–4 named colours with hex values and one available font family/weight; state that look once with the sheets, not as another style ballot. Example "Look: ivory, charcoal and sage with Inter SemiBold, because the museum displays need quiet backgrounds and readable labels." Check font availability with scene-engine before promising it.
2. Put EIGHT items in the prompt: medium/format, one reference discipline/era, composition/camera, lighting, palette with hex values, typeface names/weights, texture and exclusions. Example for a style frame: "Flat motion graphics; Swiss poster discipline; one real editor screenshot below a left-aligned headline; even light with no reflections; the brief's ivory #F4F0E8, charcoal #202020 and sage #83947B; Inter SemiBold headline and Inter Regular UI; fine grain only on the background; no extra controls, glow or decoration." Use those example values only if they match this film's chosen look.
3. Asset plates remain photoreal or illustrated as specified. For a cut-out set transparentBackground: true, keep the complete silhouette inside margins and request no floor/backdrop. Assets without words say "no text, no lettering, no logos". Storyboard panels instead render the exact approved onScreenText in the film's real typefaces.

## Storyboard style-frame preset
4. Every panel is a COLORED final-frame pitch at motion-design quality. Match the film's actual palette, font family/weight, exact words, layout, object counts, camera, UI cards, shapes and 3D objects. Example: an ivory pawn hits a charcoal king on the approved sage board; the real headline sits in its final position. A blank rectangle labelled "A BIG HEADLINE" fails. Use supplied product UI, with zero invented dashboard controls.
5. Use flat motion graphics or clean-rendered 3D that scene code can build. Example: matte extruded type with one directional shadow, not a reflective chrome title added without a brief. Keep the same material, lighting and texture across panels. A muted film-grain gradient is allowed when that gradient is part of the film; a random purple-blue gradient is not.
6. Put ZERO annotations, arrows, production captions, borders, shot numbers or A/B labels inside the image, including gutters. Only the film's approved on-screen words appear. A/B means top/bottom row in metadata and the chat caption; shot numbers, times and motion notes stay in metadata. Thin neutral gutters divide the frames without adding a drawn page or paper texture.
7. Every PANEL keeps the film ratio: 9:16 for a Reel, 16:9 for landscape. Check storyboard's grid table: A/B with 2–3 beats each is ONE image with A above B; longer directions use separate sheets of at most 8 panels. Set sheet.panelAspectRatio to the film format and let the tool size the page. Use ONE generateImage call per sheet, count: 1; choose low if type/UI will read, otherwise medium. On the key-frame redraw, pass the chosen sheet in referenceAssetIds and keep its actual palette/type/layout.

| Bad Shot 1 | Good Shot 1 |
| --- | --- |
| A placeholder headline above an invented glossy dashboard, with purple fills and glowing orbs. | The supplied composer/timeline screenshot, actual headline "Edit your video with a sentence", the film's exact font family/weight and palette, and the same layout that scene code will build. |

## Sheet prompt template
8. Example for a brief that specifies ivory #F4F0E8, charcoal #202020, sage #83947B and Inter. Replace these with the actual film's palette/type before calling generateImage. Set phase: "sheet", count: 1, columns: 3, rows: 2; quality low only when all six panels read, otherwise medium:

"ONE colored motion-design style-frame sheet. Six panels, three columns × two rows, read left to right. The top row is option A; the bottom row is B. Every panel portrait 9:16. Thin neutral gutters and outer margins; no printed labels, panel numbers, arrows, notes or production captions. Flat motion graphics with clean matte 3D objects, Swiss poster composition, even lighting. Ivory #F4F0E8, charcoal #202020 and sage #83947B. Inter SemiBold for headlines, Inter Regular for the supplied real UI. Fine grain on the approved muted background gradient only. Render the actual final layout, objects and exact words. No generic AI gloss, glowing orbs, lens flares, sparkles, purple-blue gradients, bright purple fills or stock futuristic dashboard filler.
A1 — Seven matte charcoal editing desks recede across an ivory museum hall; set 'Seven years. Same timeline.' in Inter SemiBold.
A2 — The eighth desk fills the panel with the supplied real timeline and one sage manual cut; set 'This cut stays.'
A3 — The same desk plays the changed real edit in the approved layout; set 'Editing, finally different.'
B1 — Seven charcoal boxed displays form a straight-on grid on ivory; each repeats the same real trim; set 'Seven years. Same timeline.'
B2 — One display fills the panel with the supplied timeline and its sage manual cut; set 'This cut stays.'
B3 — The changed real edit replaces the seven-display grid; set 'Editing, finally different.'"

9. Put each panel's subject and exact copy in sheet.panels[].visual/onScreenText too; record direction, row, column, shotIndex, timing and plain motion/transition notes in metadata. Use the approved proof, real screen and real palette/type instead of copying the museum example into unrelated films. For >40 s split across sheets of at most 8 panels, continuing shotIndex per direction. Generate zero copies of reference-video frames.

## Full-size key frames and assets
10. After the user picks a sheet direction, redraw only 2–3 key frames, phase: "style", at the film's full aspect ratio. Reference the chosen sheet on EVERY call. Preserve its exact palette, font family/weight, text, composition, material and camera; this enlarges an approved look, not a new styling round. Inspect, present and stop for their review. Check scene-engine react-scenes/checklist and gsap revline, plus three-scenes/three-craft for 3D, before promising a renderable shot.
11. Assets follow motion-design image-plates: findIcon for logos/app icons, traceShape for hand-made shapes, code for type/vector/GSAP and three.js for primitives/extrusions. Use <Model> only for a user-supplied GLB. Generate textures, environment-map plates, photos and cut-outs after those checks.

## Check before presenting
12. Inspect every panel at full size: "Could scene code build this final frame 1:1 without changing its palette, type or layout?" Check every object, font/weight and exact word against the brief and metadata. A missing object, wrong font, invented control, generic gloss or annotation fails. Regenerate only the failed sheet/key frame once with the exact correction; use medium if low made the type/UI unreadable. If the second attempt fails, explain the defect in one sentence and stop for the user.
13. Reject generic AI gloss, glowing orbs, lens flares, sparkles, purple-blue gradients, bright purple fills and stock "futuristic dashboard" filler. Example bad: floating chrome UI ribbons above a purple glowing orb. Good: the supplied app panel on the film's charcoal background with flat sage selection marks. Also reject unrequested neon/glow lines, glassmorphism, purple-to-lime gradients, holograms, bokeh orbs, generic smiling stock people, sunset-mountain heroes and AI-looking skin. The user's liked isometric line diagrams and muted film-grain gradients can inform an actual film; their disliked cheap cursors stay out. Only an explicit user request for a specific item overrides its exclusion.
14. Call presentStoryboard only after the visual check; it publishes review images and grants ZERO approval. Over MCP embed each signed frames[].url as ![A/B style-frame sheet](url), ![Direction A](url) or ![Shot N](url), one per line. Caption each direction in at most 12 words, with one "Hooks because …" line of at most 15 words. Keep captions outside images. For assets use assets[].url. Report estimatedUsd; null is unknown. End the turn and wait for the user's actual verdict, with zero method/mode footers.

## Bad → good briefs
15. Bad: "Beautiful futuristic startup storyboard, cinematic glow." Good: "Flat motion-design frame, Swiss poster composition. Portrait 9:16; supplied composer screenshot below the real line 'Edit your video with a sentence'. Use the brief's ivory #F4F0E8, charcoal #202020 and sage #83947B; Inter SemiBold title, Inter Regular UI. Even light, matte cards, fine grain only on the muted background gradient. No orb, gloss, flare, purple fill, annotation or invented UI." Replace the example palette/type with the actual brief.
16. Bad: "Woman holding a card, beautiful skin, sunset." Good: "35mm studio close-up, documentary still-life discipline. One adult hand holds a blank card, wrist entering below, complete silhouette with margins. Broad soft side light; natural umber, ivory, warm grey; real skin creases and subtle grain. Transparent cut-out. No floor, scenery, face, lettering, jewellery or beauty retouching."
`,
};
