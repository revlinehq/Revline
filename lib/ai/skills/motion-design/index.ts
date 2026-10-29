import type { EditorSkill } from '../index';
import { STYLE_CARDS } from './cards';
import { STYLE_PAGES, TECHNIQUES } from './styles';
import { brandPage, craftPage, intakePage, processPage, storyPage } from './pages';

export const motionDesign: EditorSkill = {
  name: 'motion-design',
  description: 'Launch and feature films made from scratch (motion design, no footage needed): the ordered workflow from brand kit to finished film, with pages for brand, intake, story, styles from 14 analysed launch films, techniques by feedback, motion craft, and process. Read before any launch, announcement, teaser or feature video, and again on design feedback. Explainers and overlays on footage use explainer-scenes. Scenes themselves: scene-engine.',
  body: `# Motion design: launch and feature films

A launch film makes one product or one feature feel simple, real and worth trying, in 15 to 60 seconds. Scenes are built with the scene engine (read scene-engine). Work through the steps in order; each names the page to load with readSkill name "motion-design" and page.

## Steps
1. **Brand** (\`brand-kit\`): find or create the brand kit and confirm the brand context. Nothing is designed before the brand is known.
2. **Intake** (\`intake\`): type, format, length, platform, reference, music.
3. **Story** (\`story\`): pick the structure for the type.
4. **Style:** pick a style below; read its page and one or two of its cards. Propose the brand's motion identity (\`brand-kit\`, step 5).
5. **Beat sheet, animatic, polish, sound, review** (\`process\`), using \`craft\` for timing and easing.
6. **Feedback** at any point (\`techniques\`).

## Never speculate
Every fact on screen comes from the confirmed brand context or the user: names, features, numbers, claims, prices, dates, availability, the URL. Missing? Ask. Never invent a statistic, customer, feature or UI the product does not have.

## How much to follow the library
The styles, cards and techniques come from measured launch films. They are a strong starting point, not a rulebook:
- **No styling from the user:** pick a style and follow it.
- **Vague direction or feedback** ("more premium", "snappier", "the ending is weak"): find it on \`techniques\`, read the named card, apply it, and say which film it comes from so the user can accept or refuse.
- **Exact direction:** do exactly that. Use the library only for what the user left open (durations, eases, holds). Never override the user.
- You may deviate from a style or default when the brand, the content or the user calls for it; say what you changed and why. Keep one base style; borrow single techniques from others.

## Choosing a style
1. The user named a reference film or brand: the matching card and its style.
2. Otherwise match the confirmed tone and product:
   - Serious, precise, developer or AI tool, dark brand: \`dark-cinematic\` (flat UI, feature films) or \`dimensional-ui\` (the UI as a tilted 3D object, flagship launches).
   - Friendly workspace or productivity, light brand: \`warm-editorial\`.
   - Design, creative, consumer, crypto, keynote energy: \`bold-graphic\`.
   - API, data, agents, dashboards, "see it work": \`crisp-demo\`.
3. The brand kit's fonts and colors replace the style's example values; the style decides look, motion and pacing.

## What all 14 films share
- One idea per shot. Headlines and UI almost never share a frame.
- Type builds in place (word or letter reveals, typing, blur-in); it rarely slides across the screen.
- Interaction is shown by typing in real time far more often than by a cursor.
- Real product UI, cropped and magnified to the part that matters.
- One accent color; status colors stay small.
- The lockup is held 2 to 4.5 s on a calm frame, often ending on the mark alone.
- Still holds are normal while something happens in the UI.

Use a card for its style only: never its copy, product, logo, characters or exact compositions.`,
  pages: [brandPage, intakePage, storyPage, craftPage, processPage, ...STYLE_PAGES, TECHNIQUES, ...STYLE_CARDS.map(({ style: _style, ...card }) => card)],
};
