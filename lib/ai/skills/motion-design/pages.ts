import type { EditorSkillPage } from '../index';

/** Step 1: nothing is designed before the brand is known. */
export const brandPage: EditorSkillPage = {
  name: 'brand-kit',
  description: 'Step 1 of a new film for the user\'s own brand: find, create and confirm the brand kit (fonts, colors, logo, screens, product text), and how scenes use it. Not used when recreating a given video.',
  body: `# Brand kit

A brand kit is a named, saved brand for this user: colors, font files, a logo, the landing-page copy, the product text (what it is, the problem it solves, the features worth showing), and saved product screens. Scenes attach it with \`brandKitId\` and receive it as \`brand\`.

Not for recreating a video the user gave: a clone takes its brand from the video's own frames, with no kit and no questions (motion-design, "Recreating a video").

## Workflow
1. **Check first.** listBrandKits.
   - One kit clearly fits: ask "Use the <name> brand kit for this video?" and wait.
   - Several fit: name them and ask which.
   - None: ask for the website URL, or for a theme (colors, Google Fonts names, logo SVG) if there is no site.
2. **Create.** createBrandKit with the URL (and any theme values the user gave; those win). Name it after the brand.
3. **Show what was found.** Fonts by role, the main colors, whether a logo was found, and every note. Ask the user to correct anything wrong; fix it with updateBrandKit. Never pretend a missing piece was found.
4. **Confirm the product.** Draft one product text from the scraped copy: what it is, the problem it solves and the 3 to 5 features worth showing (features as short lines). Show it and ask the user to correct it, asking only about what the copy does not answer. Save the confirmed text with updateBrandKit context.product. Never build on an unconfirmed product text.
5. **Screens.** Product screenshots belong to the brand, not one project. Check the kit's screens (getBrandKit). When the user gives screenshots, offer to save them to the kit (updateBrandKit addScreens, named like editor, dashboard, settings, with a short note) so every later video reuses them without re-uploading.
6. **Use.** Pass \`brandKitId\` to addFilm or addScene (or editScene to attach or refresh; on a film it reaches every beat). A scene keeps the kit as it was when saved.

## In scene code
\`brand\` is null without a kit. With one:
- \`brand.fonts.heading\`, \`brand.fonts.body\`: loaded family names. \`font-family:'\${brand.fonts.heading}'\`.
- \`brand.colors\`: named colors (read the names with getBrandKit first and fall back when one is missing). \`brand.palette\` lists them in order.
- Kit screens arrive in \`media\` by their names (\`media.editor\`), loaded like project media; a project image attached with the same name wins.
- \`brand.logo\`: data URL for \`<img src>\`. \`brand.logoSvg\`: the SVG markup when vector; insert it to animate its paths.

Scraped colors are candidates, not a system: pick one background, one text color and one accent, and keep to them. Keep the accent for small things.`,
};

export const intakePage: EditorSkillPage = {
  name: 'intake',
  description: 'Step 2. What to ask before planning: type, format, length, platform, reference.',
  body: `# Intake

Ask these together, once, after the brand kit is settled. Offer sensible defaults so the user can just say yes.

- **Type:** product launch, feature launch or teaser. (Explainers and overlays on footage are a different job: explainer-scenes.)
- **Format and platform:** 16:9 for X, YouTube, a site hero; 9:16 for Reels, TikTok, Shorts; 1:1 for feeds.
- **Length:** teaser 10 to 15 s, feature 15 to 30 s, product 30 to 60 s.
- **Reference:** a film they like, or a feel in their words. It drives the style choice.
- **Audience:** who this video is for, when it changes what to show or say. Infer it from the product text and the brief otherwise.
- **Call to action:** what viewers should do at the end, and the URL. It belongs to this video, not the brand.
- **Music:** do they have a track? If not, offer to find royalty-free options.
- **Product screens:** ask for screenshots or short screen recordings of the screens the film should show (uploaded to the project, or already in its media). Real screens make the film; without them the product is shown as simplified mockups or abstract visuals. Never skip this question for a product or feature launch.`,
};

export const storyPage: EditorSkillPage = {
  name: 'story',
  description: 'Step 3. Story structures for product launches, feature launches and teasers, and why they work.',
  body: `# Story

Pick the structure for the type; adapt timings to the length. Facts on screen come only from the confirmed product text or the user.

## Product launch (30 to 60 s)
1. **Hook, 0 to 3 s:** a pattern interrupt: bold type slamming in, a product shape snapping into focus, a fast scale-in. No logo yet.
2. **Problem, 3 to 8 s:** the pain, shown concretely (a cluttered screen, a slow manual task). One image, not a list.
3. **Reveal:** the name and mark, then the product replacing the problem.
4. **Proof, the bulk:** 2 or 3 features, each as input, then action, then result. One feature per shot.
5. **Peak:** the most impressive result, held a beat longer, with the strongest sound hit.
6. **Lockup, last 2.5 s or more:** logo, one short claim, the call to action and URL, on a calm frame.

## Feature launch (15 to 30 s)
1. **Context:** where it lives in the product.
2. **Trigger:** the user's action (typing, a click, a shortcut).
3. **Result:** the feature working, step by step.
4. **Benefit:** one line on what it saves or unlocks.
5. **Availability and call to action:** "Available today", the plan, the URL, the logo.

## Teaser (10 to 15 s)
Hook, one striking product moment, lockup with a date or "coming soon".

## Why it works
- **Attention:** sudden motion and contrast stop a scroll. Something moves in the first 0.3 s.
- **Problem, then solution:** the viewer has to feel the gap before the product closes it. Skip the problem only when the benefit is obvious from the result.
- **Progressive disclosure:** input, then action, then result, one at a time. Text lands after the visual it names.
- **Motion as metaphor:** connecting lines for integration, stacking for organising, handing a card across for collaboration or agents, zoom for "this matters", assembly for "it all comes together". A move that shows no relationship, action or hierarchy gets cut.
- **Peak and end:** viewers remember the best moment and the last one. Build to one peak; end on a held lockup.
- **Craft is trust:** precise timing and consistent easing read as a careful product.`,
};

export const scriptPage: EditorSkillPage = {
  name: 'script',
  description: 'Step 4. Write every on-screen word as one piece, in a voice that fits the brand, and get it approved before the beat sheet.',
  body: `# Script

On-screen words carry the story; the motion shows each line happening. Write them together, before any timing or code, and get them approved.

## Facts versus words
Facts must be true and come from the confirmed product text or the user: what the product does, names, numbers, claims, the URL. The wording is yours to write. Never paste website headings or section labels as captions just because they are true; rewrite them for film.

## How to write it
1. Write the whole film's words as one list, top to bottom, one line per card. Nothing else.
2. Read it aloud in order, without visuals. It should tell the story on its own and sound like one voice. If it sounds like a feature list or a website menu, rewrite it.
3. Give it a through-line: a word, rhythm or idea that returns and pays off at the lockup (for example a word that appears in the hook and comes back in the final line).
4. Decide the voice for this film from the brand's own site copy, the confirmed product text and the user's direction, and keep every line in it. Say it in one line above the script (e.g. "plain, confident, a little dry").

## Rules for lines
- One thought per card. 2 to 6 words for most cards; a headline at most about 8.
- Concrete verbs and nouns of what happens on screen ("Cut.", "Captioned.") beat abstract benefits ("Effortless editing").
- The visual makes the claim; the line names it. Do not describe what the viewer can already see in more words.
- Never a section label as a caption ("Post it anywhere", "Key features", "How it works"). Turn labels into outcomes or actions.
- Rhythm: short lines build speed, a longer line lands the point. Vary them on purpose.
- Sentence case. A period ends a statement and makes it land; no exclamation marks.
- Avoid filler and hype: seamless, revolutionize, powerful, unlock, supercharge, game-changing, next-level, effortless, "AI-powered" as decoration, and questions as hooks unless the brand's own copy uses them.
- UI sample text inside mockups stays plain and generic and never repeats the captions.

## Before the beat sheet
Send the script as a numbered list with the beat each line belongs to (hook, problem, reveal, proof, peak, lockup) and wait for approval or edits. Changes here are cheap; after the animatic they are not.`,
};

export const craftPage: EditorSkillPage = {
  name: 'craft',
  description: 'Motion craft at film scale: the hard rules every film follows; timing is tuned from feedback.',
  body: `# Motion craft

Film scale: full-screen 1080p, 30 fps. These are real failures to avoid.

## Must
- Nothing that travels across the frame moves linearly. Linear is for progress bars, rotation loops and slow continuous camera drifts that span a whole shot.
- One hero move at a time; dim what is not the hero when the frame is busy.
- Text holds at least 1 s plus 0.3 s per word after it lands.
- Overshoot past 25% looks broken.
- An important change is never a fade alone: pair opacity with a move, scale or blur.
- Scale: the hero of each shot fills 40 to 70% of the frame's width or height. A small graphic floating in empty space reads as unfinished; crop in, scale up, or move the camera closer.
- Accent: the brand accent colors only small things (a caret, a send button, a playhead, an underline, one highlighted word, a thin outline). Never fill bars, cards, nodes, frames or backgrounds with it; use the brand's neutrals for those.
- No eyebrow or kicker labels (a small caps word such as the brand name above a headline). The headline stands alone.
- A headline and the product visual get separate moments or clearly separate zones; never a caption pinned to the top of every shot with a small visual underneath.

## Timing
No fixed duration, hold or beat-length tables. Keep each shot only as long as its action plus reading time, cut dead holds, and tune pacing from the user's feedback (save approved pacing with remember).`,
};

export const processPage: EditorSkillPage = {
  name: 'process',
  description: 'Beat sheet, animatic, feedback, polish, sound and review; plus showing the product with real screenshots or mockups.',
  body: `# Process: approve before building

1. **Beat sheet.** Built from the approved script. Start with the film's style direction (five lines), then a table: time, music bar, what is on screen, on-screen words (from the script, unchanged), motion, sound. Send it and wait for approval or changes.
2. **Animatic.** The film as one addFilm call at the approved timing, cut at the beats: grey boxes, plain text in the brand font, simple moves, with the music. Say it is rough; ask the user to watch story and pacing.
3. **Feedback.** Whenever the user reacts ("feels cheap", "more energy", "the ending is weak"), read the techniques page, apply the matching technique, and say which film it comes from. Exact instructions from the user are followed as given.
4. **Polish.** Refine the film in place, beat by beat, with patchScene (one call can replace a whole \`<Beat>\` block or a component); every beat clip gets each change. Attach the brand kit with editScene brandKitId (the film's beats share it). Follow the film's style direction and the craft page.
5. **Music and sound.** Place the track first and mark its beats. Let the story set the cuts (top launch films land only 0 to 30% of cuts on beats); put key entrances and sound hits on accents and the peak on the drop. Then one generateSound per beat clip keyed to its motion (a film's beats show film time, so key each to its window), under the music (read music-and-sound).
6. **Review.** getFrames at each beat and each scene's midpoint. Check that text is readable, nothing overlaps or clips, the brand fonts, colors and logo show, and the lockup holds. Fix before saying it is done; say what you checked.
7. **Learn.** When the user approves a change in direction (a different ease, pacing, a technique), offer to save it to memory with remember, so the next film for this brand starts from it.

## Product UI
When something inside the UI has to move, use the kit's blueprint or build one (blueprints page); when the whole UI just moves or holds, use the screenshot. Real screenshots and screen recordings beat mockups: they show the actual product and build trust. First use the brand kit's screens (getBrandKit); they reach every scene with the kit attached as \`media.<name>\`. Otherwise ask the user for screenshots or short recordings of the screens the script shows (or offer to use ones already in the project's media), upload them, and attach them to scenes as \`media\` (scene-engine, Project media). A recording shows a real interaction; a screenshot with animated HTML on top shows a controlled one. Crop and magnify the part that matters, move a camera over them, tilt them, and layer animated HTML on top (a typed prompt, a highlight, a cursor) to show the action.
Without screenshots, build the UI as HTML mockups in the brand's fonts and colors: windows, inputs, cards, lists, timelines. Show only what the product text describes, with generic sample content.`,
};

export const blueprintsPage: EditorSkillPage = {
  name: 'blueprints',
  description: 'Product UI that moves: rebuild a kit screen as a blueprint (live HTML with named parts) by measuring it, scoring the rebuild against it, and saving it to the kit; then mount it in scenes and animate its parts. When to use the screenshot instead.',
  body: `# Blueprints: the product's real UI, rebuilt to move

A blueprint is a kit screen rebuilt as a responsive scene module: every piece (header, sidebar, composer, tab, clip, button) is HTML with a \`data-part\` name, measured from the screen's pixels and scored against it. Once saved in the brand kit, every film for that brand can mount it.

## Screenshot or blueprint, per shot
Decide in the beat sheet, shot by shot:
- **The UI moves as a whole** (pan, tilt, zoom, held as a backdrop): use the **screenshot** (\`media.<screen>\`). It is exact and free.
- **Something inside the UI moves** (the composer types, clips slide in, a button is pressed, a panel lifts out): use the **blueprint**.
- Also the blueprint when the shot **zooms deep** (HTML stays sharp, a screenshot blurs past 2x), needs a **size the screenshot lacks**, or shows **changed text** (a different prompt, the user's own content).
- **Mixing is fine:** open on the screenshot and cut to the blueprint when interaction starts; at a 95%+ match the swap is invisible.
If the kit already has a blueprint for that screen (listBlueprints), use it; build one only when it is missing.

## Building one
Fonts and the logo come from the kit; colors and positions come from the screen. Never type a size, color or radius by eye.
1. **Source.** Use an untouched capture from the kit (getBrandKit screens). Never measure an edited screenshot: painting over a badge or cursor also erases what was under it. Ask for a new capture instead.
2. **Measure** with measureScreen: colors at points, and lines across every region (a row across the header, a column down the sidebar, both axes through each button). Each change along a line is an edge. Read every box's **width and height**, not only where it starts, and read corner curves (where the edge reaches the straight side gives the radius). Snap a color to the kit's palette only when they are nearly identical.
3. **Identify the icon set.** Lucide is built in: \`icon('scissors', { size, color })\` returns the real icon. Match a few icons by shape and use Lucide names. Brand logos and app icons come from findIcon (the official SVG), other icons Lucide lacks from findIcon style ui; draw an SVG only for what neither has.
4. **Build** a scene module that takes \`{ root, width, height, brand, media, icon }\` and lays the UI out **responsively**: fixed parts keep their measured size (a sidebar 400px wide, a header 56px tall), regions that stretch take the rest, right-hand items anchor to the right edge, centered things stay centered. Give every meaningful piece \`data-part\`. Use the measured pixels at the screen's size; photos inside the UI (footage, avatars) may be cropped from the screen media.
5. **Compare** with compareScreen (code, at the screen's size). Read the per-part scores, not only the total: a 96% screen can hide a part at 0%. Fix the lowest parts first (look at the red diff image), compare again. Text-heavy parts score lower than flat ones because of anti-aliasing; judge them by the image.
6. **Save** with saveBlueprint (the compare's checkId, a short name, the colors and edges you measured with labels). Aim for 95%+ overall with no flat part (button, panel, divider) under 90%.
7. **Other sizes.** A blueprint renders at any size; check desktop (1920x1080) and laptop (1440x900) with compareScreen width and height when the kit has captures at those sizes; otherwise say those sizes are unverified.

## Using one in a scene
- Attach it: addFilm, addScene or editScene with \`brandKitId\` and \`blueprints: ['Editor']\`.
- Mount it: \`const ui = blueprint('Editor', container, { width: 1600, height: 1000 })\` builds the whole UI inside \`container\` and returns its root. Scale or tilt the container to frame it.
- Animate its parts: \`ui.querySelector('[data-part=composer]')\`. Typical moves: show the whole dashboard, then lift one part out (scale up, shadow, the rest dims); replace a part's content (type a new prompt, swap a clip); transition one part into the next shot; build the UI part by part.
- Keep the blueprint static itself; all motion lives in the scene.`,
};

