import type { EditorSkillPage } from '../index';

// Revline's transition recipes: the moves launch films are made of, each as a short useTimeline snippet on the frame clock.
// A motion log names each moment's transition type; the type picks the recipe here.

const recipe = (name: string, description: string, body: string): EditorSkillPage => ({ name: `recipe-${name}`, description, body });

const letterReveal = recipe('letter-reveal', 'Letter-by-letter or word-by-word reveal: SplitText chars rising out of blur, staggered.', `# Letter-by-letter reveal

**Motion-log words:** letters appear one by one, letter reveal, type builds, characters fade/rise in, wordmark spells out, staggered letters, words pop in one after another.

\`\`\`tsx
function Reveal({ text, at = 0 }: { text: string; at?: number }) {
  const ref = useTimeline<HTMLDivElement>((tl, el) => {
    const { chars } = new SplitText(el, { type: 'chars' });
    tl.from(chars, {
      opacity: 0, yPercent: 60, filter: 'blur(10px)',
      duration: .5, ease: 'expo.out',
      stagger: { each: .035, from: 'start' },   // onset spread = each * (chars.length - 1)
    }, at);
  });
  return <div ref={ref} style={{ font: '500 96px/1 "Source Serif 4"', whiteSpace: 'pre' }}>{text}</div>;
}
\`\`\`

- **Timing:** each letter .35 to .6 s; stagger .02 to .05 s per letter (a 10-letter word spells out in about .3 to .5 s). Words instead of chars: \`type: 'words'\`, stagger .06 to .12 s.
- **Eases:** \`expo.out\` or \`power3.out\` (fast arrival, soft settle). \`back.out(1.6)\` for playful pops (use scale .6 to 1 with it).
- **Measure it:** bracket with readFrames fps 10, refine onset with adjacent frames. For N>1, \`each=(last onset-first onset)/(N-1)\`; settle also includes letter duration.
- **Variants:** from the center \`from: 'center'\`; letters sliding up from a line \`yPercent: 100\` with the element \`overflow: hidden\` (a mask under the baseline); a wordmark revealing behind its logo: \`x: -40, opacity: 0\` from the logo side.
- Only animate transforms, opacity and short blurs: blur on 30+ letters at 1080p is costly, keep it under .5 s.`);

const writeOn = recipe('write-on', 'Write-on and draw-on: strokes, spirals, underlines and signatures drawn with DrawSVG; handwritten type written letter by letter.', `# Write-on and draw-on

**Motion-log words:** draws on, writes on, stroke draws, line traces, spiral draws in, signature, handwriting appears, underline draws, scribble, circle drawn around.

**A stroke** (an SVG path with \`fill="none"\` and a stroke: a spiral, underline, arrow, a traced shape from traceShape):
\`\`\`tsx
function Spiral({ d, at = 0 }: { d: string; at?: number }) {
  const ref = useTimeline<SVGSVGElement>((tl, el) => {
    tl.fromTo(el.querySelector('path'), { drawSVG: '0%' }, { drawSVG: '100%', duration: .8, ease: 'power2.inOut' }, at);
  });
  return <svg ref={ref} viewBox="0 0 200 200" width={320}><path d={d} fill="none" stroke="#111" strokeWidth={14} strokeLinecap="round" /></svg>;
}
\`\`\`
Without DrawSVG: \`const len = path.getTotalLength(); gsap.set(path, { strokeDasharray: len, strokeDashoffset: len })\` where the path is built, then \`tl.to(path, { strokeDashoffset: 0, … }, at)\`. Draw from the other end with \`drawSVG: '100% 100%'\` to \`'0% 100%'\`.

**Handwritten type in a font** (VOICE TYPING in a marker font): wipe each letter open in the writing direction, one after another, at pen speed:
\`\`\`tsx
const ref = useTimeline<HTMLDivElement>((tl, el) => {
  const { chars } = new SplitText(el, { type: 'chars' });
  tl.fromTo(chars, { clipPath: 'inset(-20% 100% -20% 0)' },
    { clipPath: 'inset(-20% 0% -20% 0)', duration: .14, ease: 'none', stagger: .09 }, at);
});
\`\`\`
- **Timing:** a stroke .5 to 1.2 s; a word written by hand .08 to .12 s per letter, each letter .1 to .18 s with \`ease: 'none'\` (a pen moves steadily). A spiral or circle \`power2.inOut\`; an underline \`power3.out\` .4 to .6 s.
- The colored newest letters some films show while writing are the typing recipe's highlight (page \`recipe-typing\`) layered on these chars.
- A path's direction is its draw direction: if it draws backwards, reverse the drawSVG values instead of editing the path.`);

const maskWipe = recipe('mask-wipe', 'Mask wipe: clip-path inset or polygon reveals and hides, straight or diagonal, element or whole frame.', `# Mask wipe

**Motion-log words:** wipes in, wipe, reveals left to right, uncovered, slides out from behind, curtain, diagonal wipe, panel opens, card unmasks, iris, split reveal.

\`\`\`tsx
function Wipe({ children, at = 0, from = 'left' }: { children: React.ReactNode; at?: number; from?: 'left' | 'right' | 'top' | 'bottom' }) {
  const closed = { left: 'inset(0% 100% 0% 0%)', right: 'inset(0% 0% 0% 100%)', top: 'inset(0% 0% 100% 0%)', bottom: 'inset(100% 0% 0% 0%)' }[from];
  const ref = useTimeline<HTMLDivElement>((tl, el) => {
    tl.fromTo(el, { clipPath: closed }, { clipPath: 'inset(0% 0% 0% 0%)', duration: .6, ease: 'expo.inOut' }, at);
  });
  return <div ref={ref}>{children}</div>;
}
\`\`\`
- **Diagonal:** tween polygons with the same number of points: \`'polygon(0% 0%, 0% 0%, 0% 100%, 0% 100%)'\` to \`'polygon(0% 0%, 120% 0%, 100% 100%, -20% 100%)'\`.
- **Rounded or circular:** \`inset(… round 24px)\` keeps a card's corners; an iris is \`circle(0% at 50% 50%)\` to \`circle(75% at 50% 50%)\`.
- **Wipe out:** the same values reversed at the exit time (\`tl.to(el, { clipPath: closedOtherSide }, out)\`), usually leaving on the opposite side it came in.
- **Timing:** .4 to .8 s; \`expo.inOut\` or \`power4.inOut\` for a deliberate wipe, \`power3.out\` for a fast reveal. A wipe that carries content (text sliding with the mask edge): add \`x: -40\` to \`0\` on the child with the same duration and ease.
- Number formats must match on both ends (all % or all px), or GSAP cannot interpolate the clip path.`);

const blurIn = recipe('blur-in', 'Blur-in and motion blur: focus pulls, and fast moves smeared with blur plus a stretch along the direction of travel.', `# Blur-in and motion blur

**Motion-log words:** blurs in, comes into focus, defocus, smeared, streaks in, whips in, flies in fast, motion blur, zooms past, snaps into place.

**Focus pull** (no movement): \`tl.from(el, { filter: 'blur(24px)', opacity: 0, scale: 1.06, duration: .6, ease: 'power3.out' }, at)\`.

**Motion blur on a fast move:** blur rises with speed and the element stretches along the direction of travel, both gone as it lands. A horizontal fly-in:
\`\`\`tsx
const ref = useTimeline<HTMLDivElement>((tl, el) => {
  const d = .45;
  tl.from(el, { x: -900, duration: d, ease: 'expo.out' }, at)
    // stretch and blur peak at the start, where expo.out is fastest, and resolve as it settles
    .fromTo(el, { scaleX: 1.35, scaleY: .92, filter: 'blur(14px)' },
      { scaleX: 1, scaleY: 1, filter: 'blur(0px)', duration: d * .7, ease: 'power2.out' }, at);
  gsap.set(el, { transformOrigin: '100% 50%' });   // stretch trails behind the leading edge
});
\`\`\`
- Vertical travel stretches \`scaleY\` instead. CSS blur is the same in every direction; for a true directional streak put an SVG \`feGaussianBlur stdDeviation="14 0"\` filter on the element (\`filter: 'url(#mb)'\`) and tween its stdDeviation attribute.
- For many elements moving together (keys flying into a row), stagger the whole recipe .04 to .08 s per element.
- **Timing:** a fly-in .3 to .6 s, blur 8 to 20 px at the peak; a focus pull .4 to .8 s. Eases: \`expo.out\` for the move, \`power2.out\` for the blur and stretch so they clear before the move ends.
- Blur budget and exceptions: ≤8 elements for ≤0.5 s (revline); verify before/mid/settle with getFrames.`);

const morph = recipe('morph', 'Morph: one shape or UI state turning into another, with MorphSVG or a manual FLIP between two layouts.', `# Morph

**Motion-log words:** morphs into, turns into, becomes, transforms, the pill grows into a card, the button expands, the icon reshapes, shared element carried over, one shape to another.

**Shapes** (SVG paths): MorphSVG matches the points for you.
\`\`\`tsx
const ref = useTimeline<SVGSVGElement>((tl, el) => {
  tl.to(el.querySelector('#from'), { morphSVG: '#to', duration: .6, ease: 'power3.inOut' }, at);
});
// <path id="from" d={circle} /> and <path id="to" d={star} style={{ visibility: 'hidden' }} />
\`\`\`
Use \`morphSVG: { shape: '#to', type: 'rotational' }\` when a twist looks wrong, and \`shapeIndex\` to pick where the points line up.

**UI states** (a pill growing into a card, a key becoming a button): one element whose box tweens between the two layouts. The Flip plugin is not loaded; measure both states where the timeline is built and tween the difference:
\`\`\`tsx
const ref = useTimeline<HTMLDivElement>((tl, el) => {
  // el is laid out in its final state; start it at the pill's size and place
  tl.fromTo(el, { width: 220, height: 64, x: 180, y: 260, borderRadius: 32 },
    { width: 860, height: 300, x: 0, y: 0, borderRadius: 24, duration: .7, ease: 'expo.inOut' }, at)
    .from(el.children, { opacity: 0, y: 12, duration: .3, stagger: .05, ease: 'power2.out' }, at + .45);
});
\`\`\`
- For one <1 s panel morph, reveal children in the final 40%; keep the frame clipping them (revline).
- Across a beat cut inside a film the morph is one tween in the film timeline running through the cut; never two clips that each do half.
- **Timing:** .5 to .9 s; \`expo.inOut\` or \`power3.inOut\`. Contents in .2 to .35 s, staggered .04 to .06 s.`);

const typing = recipe('typing', 'Typing: text appearing letter by letter at keyboard or dictation speed, with the newest letters in a highlight color fading to ink.', `# Typing with a colored highlight

**Motion-log words:** types, typing, typed out, dictation, words stream in, text fills the box, cursor, the newest letters are colored, live transcription.

\`\`\`tsx
function Typed({ text, at = 0, cps = 28, color = '#8f7ae5', ink = '#1d1d1b' }: { text: string; at?: number; cps?: number; color?: string; ink?: string }) {
  const ref = useTimeline<HTMLDivElement>((tl, el) => {
    const { chars } = new SplitText(el, { type: 'chars' });
    gsap.set(chars, { opacity: 0, color });
    chars.forEach((char, i) => {
      const t = at + i / cps;
      tl.set(char, { opacity: 1 }, t)                                // appears on its keystroke
        .to(char, { color: ink, duration: .35, ease: 'power1.out' }, t + .12);  // the newest ~4 letters stay colored
    });
  });
  return <div ref={ref}>{text}</div>;
}
\`\`\`
- **Speed:** keyboard 12 to 20 chars/s, dictation and live transcription 25 to 40 chars/s, often word by word (split \`type: 'words'\` and step per word at 3 to 5 words/s). Read the reference at fps 10 and count letters between frames for its cps.
- **Highlight length:** the color hold (\`.12\` above) times cps is how many letters stay colored; match what the reference shows (3 to 8 letters).
- Deleting text: the same in reverse, \`tl.set(char, { opacity: 0 }, t)\` from the last char back, usually faster (40 to 60 chars/s).
- A caret: a thin bar element whose x you \`tl.set\` to each char's \`offsetLeft + offsetWidth\` (and y to its line) at the char's time, measured where the timeline is built.
- Lay the text out at its final size from the start (opacity 0 chars keep their space), so lines never reflow while typing.`);

const flyOff = recipe('fly-off', 'Fly-off: an element leaving fast with a tilt and blur, often staggered, as an exit or hand-off.', `# Fly-off with tilt and blur

**Motion-log words:** flies off, flies away, thrown out, tossed, swept off, exits fast, cards scatter, leaves with a spin, knocked out of frame.

\`\`\`tsx
const ref = useTimeline<HTMLDivElement>((tl, el) => {
  tl.to(el.querySelectorAll('.item'), {
    x: (i: number) => 700 + i * 120, y: (i: number) => -260 - i * 40,
    rotation: (i: number) => 18 + i * 6,
    filter: 'blur(10px)', opacity: 0,
    duration: .5, ease: 'power3.in',
    stagger: { each: .05, from: 'end' },
  }, at);
});
\`\`\`
- **The tilt** leans into the direction of travel (moving right and up: positive rotation 10 to 25 degrees); set \`transformOrigin\` on the trailing edge for a toss.
- **Blur and fade** start late in the move: split them into a second tween at \`at + .2\` with \`power2.in\` if the reference keeps the element sharp at first.
- **Timing:** .35 to .6 s, \`power3.in\` or \`expo.in\` (slow start, fast exit). Stagger .03 to .08 s; \`from: 'end'\` so the last item leaves first when they pile up.
- A fly-off that hands over to the next beat overlaps its entrance by .1 to .2 s: start the next element's fly-in before this exit ends.`);

const transitionsIndex: EditorSkillPage = {
  name: 'transitions',
  description: 'Transition recipes for launch films and remakes: which motion-log words map to which recipe page (letter reveal, write-on, mask wipe, blur-in and motion blur, morph, typing, fly-off).',
  body: `# Transition recipes

Name each moment's transition type in the motion log, then build it with its recipe. Every recipe is a useTimeline snippet on the frame clock with its usual durations and eases; take the exact timing and ease from the reference (readFrames fps 10, trackReference) and keep the recipe's structure.

| Motion-log words | Type | Page |
| --- | --- | --- |
| letters appear one by one, type builds, words pop in, wordmark spells out | letter reveal | \`recipe-letter-reveal\` |
| draws on, writes on, stroke traces, spiral draws, handwriting, underline, signature | write-on / draw-on | \`recipe-write-on\` |
| wipes in, revealed left to right, uncovered, curtain, iris, diagonal reveal | mask wipe | \`recipe-mask-wipe\` |
| blurs in, comes into focus, smeared, streaks in, whips in, flies in fast | blur-in / motion blur | \`recipe-blur-in\` |
| morphs into, turns into, grows into, expands into, shared element across a cut | morph | \`recipe-morph\` |
| types, typing, dictation, text streams in, cursor, colored newest letters | typing | \`recipe-typing\` |
| flies off, thrown out, tossed, swept away, scatters, exits fast with a spin | fly-off | \`recipe-fly-off\` |

A moment can combine types (keys flying in with motion blur, then a morph into a pill): build each part with its recipe on the same timeline, overlapping as the reference does. Moves that only slide, scale or fade need no recipe: a \`tl.from\` with the measured ease.`,
};

export const TRANSITION_RECIPE_PAGES: EditorSkillPage[] = [transitionsIndex, letterReveal, writeOn, maskWipe, blurIn, morph, typing, flyOff];
