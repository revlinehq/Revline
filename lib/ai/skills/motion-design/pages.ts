import type { EditorSkillPage } from '../index';

/** Step 1: nothing is designed before the brand is known. */
export const brandPage: EditorSkillPage = {
  name: 'brand-kit',
  description: 'Step 1. Find, create and confirm the brand kit (fonts, colors, logo, brand context, voice, motion identity), and how scenes use it.',
  body: `# Brand kit

A brand kit is a named, saved brand for this user: colors, font files, a logo, the landing-page copy, the brand context (what the product is, the problem it solves, who it is for, key features, call to action, tone) and a motion identity. Scenes attach it with \`brandKitId\` and receive it as \`brand\`.

## Workflow
1. **Check first.** listBrandKits.
   - One kit clearly fits: ask "Use the <name> brand kit for this video?" and wait.
   - Several fit: name them and ask which.
   - None: ask for the website URL, or for a theme (colors, Google Fonts names, logo SVG) if there is no site.
2. **Create.** createBrandKit with the URL (and any theme values the user gave; those win). Name it after the brand.
3. **Show what was found.** Fonts by role, the main colors, whether a logo was found, and every note. Ask the user to correct anything wrong; fix it with updateBrandKit. Never pretend a missing piece was found.
4. **Confirm the brand context.** Draft it from the scraped copy, then ask, in one short message, only what the copy does not answer: what it is (one sentence), the problem, who it is for, 3 to 5 features worth showing, the call to action and URL, the tone. Save the confirmed version with updateBrandKit context. Never build on an unconfirmed context.
5. **Voice.** Draft how the brand sounds and confirm it in one line each: 2 to 4 tone words (e.g. plain, confident, dry), 2 or 3 sample lines (the brand's own best lines from its site, or ones the user writes), and words to avoid. Save it with updateBrandKit voice. The script follows it.
6. **Motion identity.** Once a style is chosen, propose one in a line: personality (premium, corporate, energetic, playful), a signature ease used for ~80% of motion, three durations (short, medium, long) and the one entrance pattern. Use the style's personality and the craft page's table. Save it with updateBrandKit motion when the user agrees; later videos for this brand start from it.
7. **Use.** Pass \`brandKitId\` to addScene (or editScene to attach or refresh). A scene keeps the kit as it was when saved.

## In scene code
\`brand\` is null without a kit. With one:
- \`brand.fonts.heading\`, \`brand.fonts.body\`: loaded family names. \`font-family:'\${brand.fonts.heading}'\`.
- \`brand.colors\`: named colors (read the names with getBrandKit first and fall back when one is missing). \`brand.palette\` lists them in order.
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
- **Music:** do they have a track? If not, offer to find royalty-free options.`,
};

export const storyPage: EditorSkillPage = {
  name: 'story',
  description: 'Step 3. Story structures for product launches, feature launches and teasers, and why they work.',
  body: `# Story

Pick the structure for the type; adapt timings to the length. Facts on screen come only from the confirmed brand context or the user.

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
  description: 'Step 4. Write every on-screen word as one piece, in the brand voice, and get it approved before the beat sheet.',
  body: `# Script

On-screen words carry the story; the motion shows each line happening. Write them together, before any timing or code, and get them approved.

## Facts versus words
Facts must be true and come from the confirmed brand context or the user: what the product does, names, numbers, claims, the URL. The wording is yours to write. Never paste website headings or section labels as captions just because they are true; rewrite them for film.

## How to write it
1. Write the whole film's words as one list, top to bottom, one line per card. Nothing else.
2. Read it aloud in order, without visuals. It should tell the story on its own and sound like one voice. If it sounds like a feature list or a website menu, rewrite it.
3. Give it a through-line: a word, rhythm or idea that returns and pays off at the lockup (for example a word that appears in the hook and comes back in the final line).
4. Check every line against the brand voice: its tone words, its sample lines, its words to avoid.

## Rules for lines
- One thought per card. 2 to 6 words for most cards; a headline at most about 8.
- Concrete verbs and nouns of what happens on screen ("Cut.", "Captioned.") beat abstract benefits ("Effortless editing").
- The visual makes the claim; the line names it. Do not describe what the viewer can already see in more words.
- Never a section label as a caption ("Post it anywhere", "Key features", "How it works"). Turn labels into outcomes or actions.
- Rhythm: short lines build speed, a longer line lands the point. Vary them on purpose.
- Sentence case. A period ends a statement and makes it land; no exclamation marks.
- Avoid filler and hype: seamless, revolutionize, powerful, unlock, supercharge, game-changing, next-level, effortless, "AI-powered" as decoration, and questions as hooks unless the voice uses them.
- UI sample text inside mockups stays plain and generic and never repeats the captions.

## Before the beat sheet
Send the script as a numbered list with the beat each line belongs to (hook, problem, reveal, proof, peak, lockup) and wait for approval or edits. Changes here are cheap; after the animatic they are not. When the user approves lines they like, offer to add the best ones to the brand voice's sample lines.`,
};

export const craftPage: EditorSkillPage = {
  name: 'craft',
  description: 'Motion craft at film scale: the few hard rules, then defaults for durations, easing, staggers, layers, attention and holds, with when to break them, and fixes for common complaints.',
  body: `# Motion craft

Film scale: full-screen 1080p, 30 fps. Three kinds of guidance: **Must** are real failures; **Default** is what to do unless the style, the brand's motion identity or the user says otherwise (say when you deviate); **Fix** maps complaints to causes.

## Must
- Nothing that travels across the frame moves linearly. Linear is for progress bars, rotation loops and slow continuous camera drifts that span a whole shot.
- One hero move at a time (see Attention).
- Text holds at least 1 s plus 0.3 s per word after it lands.
- Overshoot stays within budget; past 25% looks broken.
- An important change is never a fade alone: pair opacity with a move, scale or blur.

## Default: durations
| Element | Duration |
|---|---|
| Small element (icon, chip, word) | 0.3 to 0.5 s |
| Card, panel, text line | 0.45 to 0.7 s |
| Window or large UI move, camera push | 0.6 to 1.0 s |
| Hero or logo reveal | 0.9 to 1.8 s |
| Full-frame transition | 0.5 to 0.9 s |
| Ambient loop | 3 to 20 s |

- Exits take 65 to 75% of the entrance time.
- Longer travel takes longer: a move of 5% of frame height x0.8, 15% x1.0, 30% x1.3, 50% x1.5, the full frame x1.8 to 2.0.
- Slide offsets 3 to 8% of frame height (premium 2 to 3%, energetic 6 to 10%).

## Default: personality
The film's style direction names one; the brand's motion identity overrides it. Use one personality for about 90% of the film and borrow another only for a single moment.

| Personality | Short / medium / long | Signature ease | Overshoot | Entrance |
|---|---|---|---|---|
| Premium | 0.6 / 0.9 / 1.4 s | CustomEase 'M0,0 C0.4,0 0.2,1 1,1' or power2.out | 0% | fade + scale 0.98 to 1, or blur-in |
| Corporate | 0.4 / 0.6 / 0.9 s | CustomEase 'M0,0 C0.2,0 0,1 1,1' or power3.out | 0 to 3% | slide 3 to 5% + fade |
| Energetic | 0.25 / 0.4 / 0.7 s | expo.out | 15 to 30% on small things | snap in from an edge, hard cuts |
| Playful | 0.3 / 0.5 / 0.8 s | back.out(1.7) | 10 to 20% | pop with overshoot, pose swaps |

Failure modes: premium too subtle becomes invisible; energetic everywhere means nothing stands out; playful made short and bouncy looks glitchy.

## Default: easing direction
Entering: an ease-out (decelerates into place). Leaving: an ease-in (accelerates away). Moving on screen: an in-out. Loops: sine.inOut. Overshoot budget: premium 0%, a confirmation 2 to 5%, a success moment 5 to 10%, a celebration 15 to 25%.

## Default: three layers
Every moment has up to three kinds of motion:
- **Hero:** the one thing to look at (the logo scaling in).
- **Secondary:** supporting moves that start 2 to 4 frames after the hero, move 30 to 50% as far, and use a different ease (the tagline rising a little under the logo, a glow settling behind it).
- **Ambient:** background life barely noticed, 10 to 20% of the hero's movement (a gradient drifting, a slow push). Ambient never pulls focus; past about 5% scale or 2% of frame height it does.
When a frame feels flat or like a slide, a layer is missing. Calm styles may drop ambient and hold still on purpose.

## Default: attention
- At most 2 to 3 things move at once, and one of them is clearly the hero; ambient does not count.
- With 3 or more elements entering, about a third move at a time: the first settles as the third starts.
- Dim what is not the hero to 40 to 60% (optionally 2 to 4 px blur) when the frame is busy.

## Default: beat shape
Each beat has three parts: **setup** (show where we are before anything happens), **action** (the change) and **resolution** (hold the result still so it registers). Roughly 25%, 35% and 40% of the beat: for a 5 s beat, about 1.3 s, 1.7 s and 2 s. Never cut away the moment the action ends.

## Default: staggers and continuity
- Words, cards, list items: 2 to 4 frames apart (0.06 to 0.13 s); the whole stagger under about 1 s, or locked to the music. Lists top to bottom, horizontal sets left to right, heroes from the centre out, exits in reverse.
- An exit ends near where the next entrance starts, overlapping by 4 to 8 frames, so the eye has a path.

## Default: depth and physics
- Parallax: foreground 1.0x, midground 0.5x, background 0.2x of the camera move. A background may counter-move at 20 to 30%.
- Anticipation: a small move the other way (10 to 20% of the main move) before a big one; skip it for moves under 0.3 s and for premium.
- Follow-through: children trail the parent by 2 to 5 frames.
- Arcs: a natural path bows a little (3 to 5% of frame height) instead of a straight line.
- Ambient floats: different periods so nothing syncs (about 3.5 s, 4 s, 5.5 s), drift of 1% of frame height; breathing scale 0.98 to 1.02 over 3 to 4 s; gradient drift over 8 to 20 s.

## Fix
| Complaint | Usual cause | Fix |
|---|---|---|
| Robotic | linear eases, equal durations, everything synced | durations by size, ease-out entrances, staggers, secondary layer |
| Cheap or flat | only the hero moves, opacity-only changes | add secondary and ambient layers, pair fades with movement |
| Too slow | long eases on small things, holds with nothing happening | durations from the table, cut dead holds |
| Jarring | exits and entrances far apart, overshoot on big elements | the continuity rule, overshoot only on small things |
| Busy or distracting | several heroes at once | one hero, dim the rest, the one-third rule |
| No personality | mixed eases | one signature ease for 80% of motion |
For style-level complaints ("more premium", "the ending is weak"), use the techniques page.

Adapted in part from LottieFiles' motion-design skill (MIT), rescaled from interface timing to full-screen film.`,
};

export const processPage: EditorSkillPage = {
  name: 'process',
  description: 'Steps 5 to 9: beat sheet, animatic, feedback, polish, sound and review; plus building product UI without screenshots.',
  body: `# Process: approve before building

1. **Beat sheet.** Built from the approved script. Start with the film's style direction (five lines) and the films it borrows from, then a table: time, music bar, what is on screen, on-screen words (from the script, unchanged), motion, sound. Send it and wait for approval or changes.
2. **Animatic.** Rough scenes at the approved timing: grey boxes, plain text in the brand font, simple moves, with the music. Say it is rough; ask the user to watch story and pacing.
3. **Feedback.** Whenever the user reacts ("feels cheap", "more energy", "the ending is weak"), read the techniques page, apply the matching technique, and say which film it comes from. Exact instructions from the user are followed as given.
4. **Polish.** Replace each rough scene at the same timing with the finished one (editScene keeps timing). Attach the brand kit to every scene. Follow the film's style direction and the craft page.
5. **Music and sound.** Place the track first and mark its beats. Let the story set the cuts (top launch films land only 0 to 30% of cuts on beats); put key entrances and sound hits on accents and the peak on the drop. Then one generateSound per scene keyed to its motion, under the music (read music-and-sound).
6. **Review.** getFrames at each beat and each scene's midpoint. Check that text is readable, nothing overlaps or clips, the brand fonts, colors and logo show, and the lockup holds. Fix before saying it is done; say what you checked.
7. **Learn.** When the user approves a change in direction (a different ease, pacing, a technique), offer to save it: to the brand's motion identity with updateBrandKit, or to memory with remember. The next film for this brand starts from it.

## Product UI without screenshots
Until scenes can show project media, build product UI as HTML mockups in the brand's fonts and colors: windows, inputs, cards, lists, timelines. Crop and magnify the part that matters. Show only what the brand context describes, with generic sample content.`,
};
