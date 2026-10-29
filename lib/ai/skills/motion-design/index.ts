import type { EditorSkill } from '../index';
import { STYLE_PAGES, TECHNIQUES } from './styles';
import { blueprintsPage, brandPage, craftPage, intakePage, processPage, scriptPage, storyPage } from './pages';

export const motionDesign: EditorSkill = {
  name: 'motion-design',
  description: 'Launch and feature films made from scratch (motion design, no footage needed): the ordered workflow from brand kit to finished film, with pages for brand, intake, story, script, example style directions measured from real launch films, techniques by feedback with timings, motion craft, and process. Read before any launch, announcement, teaser or feature video, and again on design feedback. Explainers and overlays on footage use explainer-scenes. Scenes themselves: scene-engine.',
  body: `# Motion design: launch and feature films

A launch film makes one product or one feature feel simple, real and worth trying, in 15 to 60 seconds. Scenes are built with the scene engine (read scene-engine). Work through the steps in order; each names the page to load with readSkill name "motion-design" and page.

## Steps
1. **Brand** (\`brand-kit\`): find or create the brand kit and confirm its product text. Nothing is designed before the brand is known.
2. **Intake** (\`intake\`): type, format, length, platform, reference, music.
3. **Story** (\`story\`): pick the structure for the type.
4. **Script** (\`script\`): write every on-screen word as one piece, in a voice that fits the brand; get it approved.
5. **Style direction:** write the film's own direction (see below), drawing on the example directions and techniques.
6. **Beat sheet, animatic, polish, sound, review** (\`process\`), following the \`craft\` rules. In the beat sheet, decide each shot's product UI: the kit's screenshot when the UI moves as a whole, its blueprint when something inside it moves (\`blueprints\`).
7. **Feedback** at any point (\`techniques\`).

## Never speculate
Every fact on screen comes from the confirmed product text or the user: names, features, numbers, claims, prices, dates, availability, the URL. Missing? Ask. Never invent a statistic, customer, feature or UI the product does not have.

## Style direction
There are no presets. Each film gets its own short direction, fitted to the brand and the story, written as five labeled lines (never one summary sentence): **look** (canvas, palette use, texture), **type** (how words enter and hold), **product UI** (how it is framed and shown), **motion** (personality, signature ease, camera), **pacing** (shot lengths, holds, cutting). Put it at the top of the beat sheet.

Build it from the library, which is knowledge, not a menu:
- The **example directions** (\`dark-cinematic\`, \`dimensional-ui\`, \`warm-editorial\`, \`bold-graphic\`, \`crisp-demo\`) show what a coherent direction looks like. Start from the closest one, or combine them.
- The **techniques** page maps feedback to concrete techniques with their durations and eases.

How much to follow it:
- **Exact direction from the user:** do exactly that; use the library only for what they left open (durations, eases, holds). Never override the user.
- **A reference** (a film or brand they like): ask for the link or a description, then build the direction from what it does (look, type, UI, motion, pacing), never its content.
- **Vague direction or feedback** ("more premium", "snappier", "the ending is weak"): find it on \`techniques\`, apply the technique, and say which one you used so the user can accept or refuse.
- **Nothing given:** choose from the brand's site, context and product, e.g. a serious dark developer tool leans toward the dark or dimensional examples, a friendly light workspace toward warm-editorial, a creative or consumer brand toward bold-graphic, a data or agent product toward crisp-demo.
- Keep the direction consistent across the film; borrow single moments from elsewhere on purpose. The brand kit's fonts and colors always win over example values.

## What strong launch films share
- One idea per shot. Headlines and UI almost never share a frame.
- Type builds in place (word or letter reveals, typing, blur-in); it rarely slides across the screen.
- Interaction is shown by typing in real time far more often than by a cursor.
- Real product UI, cropped and magnified to the part that matters.
- One accent color; status colors stay small.
- The lockup is held 2 to 4.5 s on a calm frame, often ending on the mark alone.
- Still holds are normal while something happens in the UI.

Borrow a reference's style only: never its copy, product, logo, characters or exact compositions.`,
  pages: [brandPage, intakePage, storyPage, scriptPage, craftPage, processPage, blueprintsPage, ...STYLE_PAGES, TECHNIQUES],
};
