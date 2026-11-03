import type { EditorSkill } from '../index';
import { blueprintsPage, brandPage } from './pages';
import { imagePlatesPage } from './image-plates';
import { tastePage } from './taste';

export const motionDesign: EditorSkill = {
  name: 'motion-design',
  description: 'Motion design made from scratch, with no footage on screen: launch and feature films, product and feature reels, teasers, any standalone motion scene, and faithful motion-film copies when requested (shot for shot from their frames, with no brand questions). How films are built (one clip, one timeline, patchScene edits), the recreation method, original design judgment (page "taste"), and the user\'s rules for facts and feedback; pages for the brand kit and blueprints (product UI that moves). Read before any launch, announcement, teaser, feature video or standalone motion scene. Explainers and overlays on footage use explainer-scenes. Every film follows overall-styling (the user\'s house look). Scenes themselves: scene-engine.',
  body: `# Motion design: launch and feature films

For edits to an existing film, start with scene-engine page \`edit-lanes\` and follow its workflow instead of the build guidance below.

Before motion design from scratch, readSkill name "storyboard": agree on the brief, then ideate one message, one audience tension and 3–5 angles before images. An accepted angle ("do it") is the concept: save it and render its sheets, with zero extra text A/B round. Answer questions directly; a request to "show me" gets the timed whole-film walkthrough, not repeated A/B text. Then choose between A/B colored style-frame sheets (one combined page for 2–3 beats each), approve 2–3 full-size key frames and the paced animatic before scene code. Resume its saved stage with readBrief. Skip small edits and "just build it". ReadSkill name "image-direction" before EVERY generateImage call for concrete art direction and visual self-checks; panels use the actual palette, type and layout the film will build. Assets during the build follow \`image-plates\`: choose icons, traced shapes, code or three.js first, then generate subjects, textures, environment maps, backgrounds and cut-outs on demand.

Follow the user's request first. A video to recreate goes through "Recreating a video" below; a new film for the user's own brand goes through "A new film" below.

**Project brief first.** Read the project's brief (getProject, inspectTimeline or readBrief) before changing anything, and follow it. When the user gives direction that should last (what to keep, what to avoid, style), update the brief with updateBrief in their own words, replacing the rule it supersedes.

For original motion design, creative restyling or learning from a style reference, read page \`taste\` before choosing the composition. It owns design judgments and the short rendered critique; copying uses the recreation workflow.

## Launch-film length and proof
1. Default to 30–40 seconds unless the user sets a length; use 35 seconds as a working example. An explicit 12-second or 60-second request wins.
2. Structure the launch as 0–5 seconds of audience tension, ONE verified product proof in the middle, and the last 4–6 seconds for the payoff line and confirmed wordmark. Example 35-second plan: 0–5 hook, 5–30 proof, 30–35 payoff. Omit the wordmark when the user says "no logo".
3. Choose the proof that most directly overturns the audience's expectation; compare at least two candidates in ideation. Bad default: typing a prompt, a podcast becomes Shorts, then a motion-design feature. Better example: one existing manual cut survives a verified multi-layer edit around it. Check readBrief and real product screens/tools before promising that operation; show its result, not only the input prompt.

## How films are built
Films are React scenes (readSkill name "scene-engine" page "react-scenes"):
- **One film = one scene clip.** The whole film is ONE React module on one continuous timeline (film seconds from its first frame), placed as ONE clip for its whole length with one addFilm call. Its sections are named timeline markers (\`sections\` on addFilm), not separate clips, so moves between sections (an element carried over, a morph, a camera push) are just tweens that run through. Split a film into clips only when the user asks. The product UI is components, one per part (\`Sidebar\`, \`Composer\`, \`DiffPanel\`), in that file.
- **Write a long film in parts.** No single call carries more than about 20k tokens (60,000 characters) of code; past that a model's output limit can cut the call off and lose it. addFilm places the whole film's clip and sections at once, with the code for the first sections and a marker where the rest goes (\`{/* more beats */}\` in the film's JSX, \`/* more parts */\` above it for components). Then one patchScene per section or two inserts the next part at the marker (\`insert: 'before'\`), so the film compiles after every call. A 21 s film is typically 3 to 4 calls.
- **Edit with patchScene; never retype the film.** Every change after the first build uses small patchScene edits. Read inspectClip with section or lines for short numbered blocks, then patch scoped snippets or line ranges with expectedRevision from that read (scene-engine, page \`react-scenes\`). Keep transitions that span sections on their shared timeline and check both sides when shared-code warnings appear. Never resend the film with editScene or rebuild a section as its own scene.
- **All motion is GSAP on the frame clock.** Every move, even a single fade, is a GSAP tween in a \`useTimeline\` timeline, one per section: connected parts are the same tween, opens and closes overlap through position parameters (\`"<"\`, \`"-=0.2"\`), staggers come from GSAP, and SplitText, MorphSVG and DrawSVG run in it (read the gsap skill, readSkill name "gsap"). Never hand-time moves with \`progress()\` and \`mix()\` at typed seconds: that is what makes holds freeze, parts drift out of sync and moves jump. Never \`linear\` except for a constant drift.
- **Correctness lives in scene-engine:** the frame clock, flash frames and preview speed (page \`react-scenes\`). This skill decides what to make; scene-engine decides how it renders correctly.

## 3D direction
Read scene-engine page \`three-craft\` on every 3D build for material identity, lighting, grounding and composition with HTML type.

Use real depth when it helps the subject: a camera push-in, a restrained orbit, or parallax between near and far objects. Mix the 3D object with readable HTML/GSAP titles in the same scene. Read scene-engine page \`three-scenes\` for ThreeLayer, camera/object timelines, lighting, models, type and CPU export limits. Use a soft fill and one directional key, matte materials and the confirmed brand palette; no sparkles or purple brand fills. All 3D motion follows the same paused GSAP timeline as 2D.

## Motion feel
Motion has weight: things open, settle and follow through. A shape that just fades in, or slides at one speed and stops dead, reads as a template. In a recreation, the eases trackReference measures win; these rules fill in whatever the reference does not show.
- **Never linear, never one curve for everything.** Entrances decelerate (\`expo.out\`, \`power3.out\`), exits accelerate (\`power2.in\`), moves from place to place use \`power3.inOut\`. Something that lands (a window, a card, a button) overshoots a little and settles (\`back.out(1.4)\`, or a small spring) over 0.4 to 0.7 s, not 0.2.
- **Open things, don't fade them in.** A window, frame, box or panel opens like a real object: it starts as a line or a small rectangle at its anchor (a corner, an edge, the thing that spawned it), grows on one axis then the other (width then height, overlapping by about a third), its border and radius stay crisp the whole way (animate width, height or clip-path, never scale, which stretches the border and type), its contents are revealed by that growing clip, then they stagger in once it has settled. Closing reverses it, faster.
- **Change things in place.** When a UI element becomes a new version of itself (a new color, a new layout, a rebuilt button), tween the same element from old to new (its box, radius, color, position) instead of crossfading two copies. A crossfade between two states always shows as a fade.
- **Connected parts move as one.** Anything that belongs together (a frame and the text inside it, a window and its contents, a button and its label, a highlight and what it marks) runs on one shared tween: same start, same ease. A frame opens and closes its content (the content is clipped by the frame's box), so no text outlives its frame and nothing waits for its container to finish before it reacts. Never animate connected parts one after another.
- **Follow-through and overlap.** Separate items in a group (list rows, cards, words in a line) stagger 40 to 90 ms apart, each starting before the previous one has fully settled. Only a soft secondary (a shadow, a glow) may trail its element by a few frames.
- **Guides and frame lines are alive.** Camera frame lines, crop corners, selection boxes and scan lines track the element they mark on the same timeline (same start, same ease), and keep moving while it does. Never leave them as a static overlay.
- **Anticipation on big moves.** Before a large move, a short wind-up (a 2 to 4 percent counter move over 0.1 to 0.15 s) makes it read as intentional.
- **Pacing is measured, not guessed.** getFrames shows stills, so speed problems slip past it: a picture that changes before it can be read, a zoom with no ease, a click that lingers, a zoom cut off by the next shot. In Precise, after building or changing motion, run checkPacing on the changed range alongside getFrames and fix what it flags (longer holds, eased moves, fewer changes per second), then run it again.
- **Deliberate holds.** Let an action settle and give the idea time to register. Keep the camera locked or the frame still when that gives the moment weight; add movement only when it reveals something.
- Recipes for each of these (eases, masks, morphs, staggers): readSkill name "gsap" page "transitions".

## Recreating a video (clone, remake, copy, "shot for shot")
The video is the brief. New recreations run Precise. In Precise, read reference-footage page \`recreation\` before building a copy or making a full-lane edit. It owns the workflow: numbered effect inventories, exact content, camera behavior per layer, one section at a time, rendered comparisons across every transition, and close-out against every inventory item. Follow its measured behavior over this skill's motion defaults. Use scene-engine for implementation and its checklist for final checks.

## A new film for the user's own brand
1. **Brand first** (page \`brand-kit\`): find or create the brand kit and confirm its product text. Nothing is designed before the brand is known.
2. **Product UI is real UI:** the kit's blueprint (page \`blueprints\`) or its screens, rebuilt strictly close to the product: measure colors, positions and sizes from the screenshots at full size (\`measureScreen\`), use the product's own icons and labels (findIcon for any brand logo or app icon, never drawn by hand), and check the build side by side (\`compareScreen\`). A screenshot appears only as what it is in the story (a file being dropped in, a thumbnail), never shown as the product.
3. **Check before handing back:** follow scene-engine page \`edit-lanes\` for existing edits or page \`checklist\` after building the film.

**Tip: one product UI, built once.** When the film shows the same product UI in several sections (for example the Revline editor), build it once as a component in the film (or the kit's blueprint) and reuse it in every section, changing only its state and framing. Base it on the real app's look: the kit's blueprint (getBlueprint), or the kit screen measured and checked with measureScreen and compareScreen. Inventing a fresh version per section gives a film with several different-looking copies of one product.

## Never speculate
In a new film, every fact on screen comes from the confirmed product text or the user (in a recreation, from the video): names, features, numbers, claims, prices, dates, availability, the URL. Missing? Ask. Never invent a statistic, customer, feature or UI the product does not have. The wording around the facts is yours to write; never paste website headings or section labels as captions just because they are true.

## Direction and feedback
- **Exact direction from the user:** do exactly that. Never override the user.
- **Reference first for faithful copies in Precise.** When the project holds a reference video (one the film is based on), go to it before building or rebuilding any moment it has a counterpart for (a transition, the ending, a price or comparison beat, a logo reveal): readFrames a short window around its matching moment, trackReference its moves and measureFrame its sizes and colors, build from that, then compareReference at that moment and fix the worst differences. Don't fall back on a generic move when the reference shows how it is done.
- **Approved work is off-limits.** Clips and film sections inspectTimeline lists as \`approved\` (with the user's note) stay exactly as they are; patchScene, editScene and every other tool refuse to touch them. Rebuild or restyle one only when the user names it in this request, passing \`overrideApproved: true\` with \`overrideReason\` quoting them. When the user approves a section, mark it with approveClip (markerId of its section) and their words as the note.
- **Feedback on one part:** change only that part, with patchScene. Every other section, title, timing, move, color and sound stays exactly as it was; never "improve" what was not asked about. If the change forces something else to shift (later timings, an audio cue), keep it otherwise identical and say what moved.
- **A style reference** (a film or brand they like, not one to recreate): use page \`taste\` to extract why its choices work and express those principles in new imagery and staging.
- The brand kit's fonts and colors always win.`,
  pages: [tastePage, brandPage, blueprintsPage, imagePlatesPage],
};
