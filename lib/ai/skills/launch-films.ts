import type { EditorSkill } from './index';

export const launchFilms: EditorSkill = {
  name: 'launch-films',
  description: 'Plan and build a product launch or feature launch film from scratch (motion design, no footage needed): intake, brand, story structure, beat sheet, animatic, polish, review. Read before making any launch, announcement, teaser or feature video. Explainers over footage use explainer-scenes instead.',
  body: `# Launch films

A launch film makes one product or one feature feel simple, real and worth trying, in 15 to 60 seconds. It is built from scenes (read explainer-scenes for the scene contract) on a brand kit (read brand-kit).

## Never speculate

Every fact on screen comes from the confirmed brand context or from the user: product name, features, numbers, claims, prices, dates, availability, the URL. Missing? Ask. Never invent a statistic, a customer, a feature or a UI the product does not have. Mock UI shows only features the context names, with plausible but clearly generic sample content.

## 1. Intake (ask together, once)

- Product launch, feature launch, or teaser? (An explainer over footage is a different job: explainer-scenes.)
- Aspect ratio and platform: 16:9 for X, YouTube, site hero; 9:16 for Reels, TikTok, Shorts; 1:1 for feeds.
- Length: teaser 10 to 15 s, feature 15 to 30 s, product 30 to 60 s.
- A reference film they like, if any.
- Brand: run the brand-kit workflow. The brand context must be confirmed before writing the beat sheet.

## 2. Structure

Pick the structure for the type; adapt timings to the length.

**Product launch** (30 to 60 s)
1. Hook, 0 to 3 s: a pattern interrupt. Bold type slamming in, a product shape snapping into focus, a fast scale-in. No logo yet.
2. Problem, 3 to 8 s: the pain, shown concretely (a cluttered screen, a slow manual task, a wall of tabs). One image of the problem, not a list.
3. Reveal: the product's name and mark, then the product itself replacing the problem.
4. Proof, the bulk: 2 or 3 features, each as input, then action, then result. One feature per shot.
5. Peak: the single most impressive result, held a beat longer, with the strongest sound hit.
6. Lockup, last 2.5 s or more: logo, one short claim, the call to action and URL, on a calm frame.

**Feature launch** (15 to 30 s)
1. Context: where this lives in the product (a recognizable product frame).
2. Trigger: the user's action (typing, a click, a shortcut).
3. Result: the feature working, step by step.
4. Benefit: one line saying what it saves or unlocks.
5. Availability and call to action: "Available today", the plan, the URL, and the logo.

**Teaser** (10 to 15 s): hook, one striking product moment, lockup with a date or "coming soon".

Problem then solution works because the viewer has to feel the gap before the product closes it. Skip the problem beat only for a feature whose benefit is obvious from the result.

## 3. Why it works, and how to do it

- **Attention.** Sudden motion and contrast trigger the orienting response; it is the only thing that stops a scroll. Open on movement in the first 0.3 s: a scale-in from 0.85, a type slam, a fast mask reveal.
- **Fluency.** What is easy to process feels easy to use. Elements assemble rather than pop; the camera moves to what matters; moves are physical (slide, scale, settle), never random.
- **Progressive disclosure.** People understand cause and effect in sequence: show input, then action, then result, one at a time. Text lands after the visual it describes, never before.
- **Motion as metaphor.** Motion stands for a relationship: connecting lines for integration, stacking for organizing, handing a card across for collaboration or agents, zoom for "this is the important part", assembly for "it all comes together". If a move does not express a relationship, hierarchy or action, cut it.
- **Peak and end.** Viewers judge by the best moment and the last one. Build to one clear peak; end on a clean, held lockup, not a hard cut.
- **Craft is trust.** Precise timing, consistent easing, generous space and perfect alignment read as a careful product. Frantic or inconsistent motion reads as cheap.
- **Anticipation, then reward.** A short build (typing, assembling, a riser) before the result makes the payoff land. Put the sound hit on the reveal.
- **Tone.** Calm pace and space read as confident and premium; faster cuts and brighter color read as energetic and consumer; dark and precise reads as focused and professional. Match the confirmed tone.

## 4. Timing rules

- One idea per shot. Shots 1.5 to 4 s.
- Reading: on-screen text holds at least 1 s plus 0.3 s per word after it lands. Headlines 2 to 6 words. Never two text blocks entering at once.
- Easing: choose three for the whole film and use nothing else: an entrance (expo.out or power3.out, 0.5 to 0.9 s), a move (power2.inOut or power3.inOut), an exit (power2.in, 0.25 to 0.4 s). back.out only on small elements.
- Staggers 0.03 to 0.08 s. Hold every important state still for at least 0.4 s.
- Music: place the track first, mark beats and downbeats, and cut on downbeats. Put entrances and sound hits on beats; the peak on the drop or the biggest accent.
- Something always moves: a slow push (scale 1 to 1.04 over the shot) under held frames.

## 5. Process: approve before building

1. **Beat sheet.** A table: time, music bar, what is on screen, on-screen words, motion, sound. Send it and wait for approval or changes. Cheap to change, so get it right here.
2. **Animatic.** Rough scenes at the approved timing: grey boxes, plain text in the brand font, simple moves, with the music. Say it is rough and ask the user to watch for story and pacing.
3. **Polish.** Replace each rough scene at the same timing with the finished one (editScene keeps timing). Attach the brand kit to every scene.
4. **Sound.** One generateSound per scene keyed to its motion, under the music.
5. **Review.** getFrames at each beat time and at each scene's midpoint. Check that text is readable, nothing overlaps or clips, the brand fonts and colors show, and the lockup holds. Fix before telling the user it is done, and say what you checked.

## 6. Product UI without screenshots

Until scenes can show project media, build product UI as HTML mockups in the brand's fonts and colors: windows, inputs, cards, lists. Keep them simplified and clearly the product's style. Show only what the context describes.`,
};
