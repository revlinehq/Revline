import type { EditorSkill } from '../index';
import { STYLE_PAGES, TECHNIQUES } from './styles';
import { blueprintsPage, brandPage, craftPage, intakePage, processPage, scriptPage, storyPage } from './pages';

export const motionDesign: EditorSkill = {
  name: 'motion-design',
  description: 'Motion design made from scratch, with no footage on screen: launch and feature films, product and feature reels, teasers, any standalone motion scene, and recreating any motion film or reference video the user gives (copied shot for shot from its own frames, with no brand questions). The ordered workflow from brand kit to finished film, with pages for brand, intake, story, script, example style directions measured from real launch films, techniques by feedback with timings, motion craft, and process. Read before any launch, announcement, teaser, feature video or standalone motion scene, and again on design feedback. Explainers and overlays on footage use explainer-scenes. Scenes themselves: scene-engine.',
  body: `# Motion design: launch and feature films

A launch film makes one product or one feature feel simple, real and worth trying, in 15 to 60 seconds. Follow the user's request first. A video to recreate goes through "Recreating a video" below; a new film for the user's own brand goes through the steps in order, each naming the page to load with readSkill name "motion-design" and page.

## How films are built
Films are React scenes (readSkill name "scene-engine" page "react-scenes"):
- **One film file; clips are windows.** The whole film is ONE React module on one continuous timeline (film seconds from its first frame), built with one addFilm call: the code plus the beat cuts. Revline cuts it into one clip per beat, each a window onto the film, so moves across a cut (an element carried over, a morph, a camera push) are just tweens that run through it. The product UI is components, one per part (\`Sidebar\`, \`Composer\`, \`DiffPanel\`), in that file.
- **Edit with patchScene; never retype the film.** Every change after the first build (feedback on one beat, a retime, a color, a line of copy) is a patchScene call with exact snippets copied from inspectClip; all beats get it. Never resend the film with editScene and never rebuild a beat as its own scene: either loses working code and breaks the moves across cuts.
- **Motion is GSAP on the frame clock.** Simple fades and slides: \`progress()\` and \`mix()\` from \`useBeat()\` time. Choreography (staggers, overlaps, word-by-word reveals, SplitText, MorphSVG, DrawSVG): \`useTimeline\`; for choreography, read the gsap skill (readSkill name "gsap").
- **Correctness lives in scene-engine:** the frame clock, flash frames and preview speed (page \`react-scenes\`). This skill decides what to make; scene-engine decides how it renders correctly.

## Recreating a video (clone, remake, copy, "shot for shot")
When the user gives a video and asks to recreate, clone, remake or copy it, the video IS the brief and the user's request is the instruction. Skip the steps below and never ask about brand, product, brand kit, website, screenshots or permission: the user supplied the video and asked for the copy.
- **Everything comes from the video:** its words (copied exactly, letter for letter), its logos and product UI (rebuilt from the frames as components), its colors (measureFrame), its fonts (the closest Google Font by eye), its timing, cuts and motion. Its brand is the brand. Never swap in another brand or invent a product.
- **Map every moment first:** readFrames over the whole video (count 16) returns the frames plus moments: every place the picture changes (start, end, strength, region, cut or motion). Shots from analyzeMedia are hard cuts only; most of a launch film's motion happens inside one shot (slides, tears, zooms, morphs, type building), so the moments are the real shot list. Stretches with no moment are holds: note their length, they are part of the timing.
- **Read every moment frame by frame:** readFrames with fps 10 from a little before the moment to a little after (up to 3 s), so a 0.4 s transition shows as 4 to 5 consecutive frames. Never rebuild a transition from only a frame before and after it.
- **Write a motion log before building, in your reply, before addFilm:** exactly one line per moment in the readFrames map, none skipped or merged (re-read any whose fps read failed), each in this form: "start–end s · element · from → to (position, scale, rotation, opacity, what it does: slides, masks, tears, morphs, types) · ease (from trackReference, or fast start then settle, steady, overshoot) · blur/color changes". A moment with no line is a moment that will be guessed. Then crops to read small type and icons.
- **Measure, don't guess:** trackReference on each moving element gives the move's start, duration and GSAP ease; measureFrame gives exact colors and sizes. Scale source pixels to the scene size.
- **Build** the whole video as one film with addFilm: one module on the reference's own timing, with a beat cut at each of its sections (a beat being one moment or a few that belong together, never one clip per detected shot: a 9 s shot can hold five moments). Moments across cuts (momentsAcrossCuts: an element carried over the cut or a morph) are tweens in the one timeline that run through the cut. Same layout, words, timing and motion; add music that matches its feel and generateSound effects on the moves. Never put the reference video itself in the edit.
- **Building waits for the reads:** addFilm, addScene and addScenes refuse a range that still has moments never read at fps 10, key moments never seen up close, or a short transition cut by a scene edge, and name them. Read those, then build. readReason is only for a moment that truly cannot be read.
- **Check, fix, check again:** compareReference at every moment you rebuilt (up to 12 per call) sets the reference beside your timeline and scores each moment. Each result names the next fix: correct the 2 worst moments with patchScene, compare again, and repeat until every moment scores 25 or less (up to 3 passes), then run the scene-engine checklist. One compare with no fix after it checks nothing.
- **Sound:** music and effects end with the film; trim any bed or loop to the last frame. If the reference has a voiceover, confirm it with analyzeMedia transcribe before relying on it (a video description can invent speech that is not there). A voiceover you cannot reproduce is not a reason to call the film incomplete: keep its timing (the on-screen words and holds already carry it), finish everything else, and mention in one line that a voiceover recording can be added later. Ask for one only when the spoken words carry the story and nothing on screen says them.
Only ask what the video cannot answer, for example a different length or format. Never ask how closely to match or whether a difference is intentional: a recreation matches the reference as closely as the tools allow, so every difference compareReference shows is yours to fix.

## Steps (a new film for the user's own brand)
1. **Brand** (\`brand-kit\`): find or create the brand kit and confirm its product text. Nothing is designed before the brand is known.
2. **Intake** (\`intake\`): type, format, length, platform, reference, music.
3. **Story** (\`story\`): pick the structure for the type.
4. **Script** (\`script\`): write every on-screen word as one piece, in a voice that fits the brand; get it approved.
5. **Style direction:** write the film's own direction (see below), drawing on the example directions and techniques.
6. **Beat sheet, animatic, polish, sound, review** (\`process\`), following the \`craft\` rules. In the beat sheet, plan each shot's product UI as real UI: always the kit's blueprint (\`blueprints\`), never a screenshot shown as the product. A screenshot appears only as what it is in the story (a file being dropped in, a thumbnail).
7. **Feedback** at any point (\`techniques\`).
8. **Check before handing back** (readSkill name "scene-engine" page "checklist"): after building the film, and after every change.

## Never speculate
In a new film, every fact on screen comes from the confirmed product text or the user (in a recreation, from the video): names, features, numbers, claims, prices, dates, availability, the URL. Missing? Ask. Never invent a statistic, customer, feature or UI the product does not have.

## Style direction
There are no presets. Each film gets its own short direction, fitted to the brand and the story, written as five labeled lines (never one summary sentence): **look** (canvas, palette use, texture), **type** (how words enter and hold), **product UI** (how it is framed and shown), **motion** (personality, signature ease, camera), **pacing** (shot lengths, holds, cutting). Put it at the top of the beat sheet.

Build it from the library, which is knowledge, not a menu:
- The **example directions** (\`dark-cinematic\`, \`dimensional-ui\`, \`warm-editorial\`, \`bold-graphic\`, \`crisp-demo\`) show what a coherent direction looks like. Start from the closest one, or combine them.
- The **techniques** page maps feedback to concrete techniques with their durations and eases.

How much to follow it:
- **Exact direction from the user:** do exactly that; use the library only for what they left open (durations, eases, holds). Never override the user.
- **Feedback on one part:** change only that part. Every other shot, title, timing, move, color and sound stays exactly as it was; never "improve" what was not asked about. If the change forces something else to shift (later timings, an audio cue), keep it otherwise identical and say what moved.
- **A reference** (a film or brand they like): ask for the link or a description, then build the direction from what it does (look, type, UI, motion, pacing), never its content.
- **Vague direction or feedback** ("more premium", "snappier", "the ending is weak"): find it on \`techniques\`, apply the technique, and say which one you used so the user can accept or refuse.
- **Nothing given:** choose from the brand's site, context and product, e.g. a serious dark developer tool leans toward the dark or dimensional examples, a friendly light workspace toward warm-editorial, a creative or consumer brand toward bold-graphic, a data or agent product toward crisp-demo.
- Keep the direction consistent across the film; borrow single moments from elsewhere on purpose. The brand kit's fonts and colors always win over example values.

## What strong launch films share
- One idea per shot. Headlines and UI almost never share a frame.
- Type builds in place (word or letter reveals, typing, blur-in); it rarely slides across the screen.
- Interaction is shown by typing in real time far more often than by a cursor.
- Real product UI, rebuilt and strictly close to the product: measure colors, positions and sizes from the screenshots at full size (\`measureScreen\`), use the product's own icons and labels, and check the build side by side against the screenshot (\`compareScreen\`) before it goes in a shot. Build it once and reuse that one build in every shot, cropped and magnified to the part that matters.
- By default, titles are small and calm, and their copy is creative and specific (a default, not a rule: when the user asks for a different title style or size, follow them): each one says what the shot shows in a fresh way (for example "Every thread, in reach." over a sidebar of threads), never a generic slogan ("Just ask.", "It just gets it done."). Write three options for each title and keep the most specific one.
- One accent color; status colors stay small.
- The lockup is held 2 to 4.5 s on a calm frame, often ending on the mark alone.
- Still holds are normal while something happens in the UI.

Borrow a reference's style only: never its copy, product, logo, characters or exact compositions.`,
  pages: [brandPage, intakePage, storyPage, scriptPage, craftPage, processPage, blueprintsPage, ...STYLE_PAGES, TECHNIQUES],
};
