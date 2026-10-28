import { HSL_BANDS, LUT_LOOKS } from '../../editor/color-finish';
import type { EditorSkill } from './index';

export const colorGrading: EditorSkill = {
  name: 'color-grading',
  description: 'Color correction and looks: measuring footage (analyzeColor), matching shots (matchColor), the base grade, curves, HSL, LUT looks and bloom, in the right order, with looks by genre and how to keep skin tones natural. Read before any color, grade, look, LUT or "make it cinematic/warmer/cooler" request.',
  body: `# Color grading

Color is two jobs, always in this order: **correct** (make shots look right and match each other), then **style** (the look). Never style uncorrected footage, and never correct after the look; a look on a mismatched edit makes the mismatch louder.

## The pipeline

1. **Measure: analyzeColor.** Read real numbers before touching anything: exposure (median, shadows, highlights, contrast range), saturation, the light's cast (warmth = red over blue, tint = green over magenta) and the dominant colors. Its notes name problems in plain words ("warm orange cast", "underexposed", "highlights clip"). It measures the source footage, before any grade.
2. **Match: matchColor.** When an edit cuts between cameras, rooms or lighting, pick the best-looking shot as the reference and match the others to it (strength 1; .6 to .8 keeps some of each shot's character). It writes the clips' red/green/blue curves. Match before any shared grade, because it compares source footage.
3. **Correct: setVisualEffects colorGrade.** Fix what analyzeColor found, using its suggestedGrade as the starting point: exposure in stops (-2..2), temperature (-100..100, negative cools an orange cast), tint (-100..100, negative removes green), contrast and saturation (1 is neutral, 0..2), vibrance (-100..100, boosts muted colors more than strong ones). Apply the same correction to every clip from one setup in one batch call.
4. **Shape: setColorCurves.** Tone and contrast after the grade. Master S-curve for punch: [[0,0],[.25,.21],[.75,.8],[1,1]]. Faded film blacks: master [[0,.07],[1,1]]. Teal shadows: blue [[0,.06],[.5,.5],[1,1]]. Keep 2 to 5 points; extreme curves posterize.
5. **Target: setHSL.** Fix or push single colors without touching the rest. Bands: ${HSL_BANDS.join(', ')}. Hue shifts in degrees (-60..60), saturation and luminance -1..1. Grays are never affected.
6. **Look: applyLut.** The creative finish, applied last. Built-in looks: ${LUT_LOOKS.join(', ')}. Or a .cube file the user provides. Most looks read best at amount .5 to .8. A clip has one LUT, and it runs after the grade: for log footage, the user's log-to-Rec709 .cube is that LUT at amount 1, the grade stays near neutral, and the look comes from curves and HSL instead of a built-in LUT.
7. **Glow: bloom** (setVisualEffects) only where the footage has real light sources: lamps, sun, neon, reflections.
8. **Check: getFrames** on a face, the brightest shot and the darkest shot after grading.

The renderer applies these in a fixed order (grade, curves, HSL, LUT), so the order you call tools only matters for what you measure and decide.

## Skin tones

Faces are the first thing viewers judge, and skin lives almost entirely in the **orange** band (with some red and yellow).

- Never shift the orange hue more than about 8 degrees, and keep orange saturation between -.3 and +.15.
- To make a look bolder without orange faces, push the other bands instead: blue and aqua for skies and shadows, green toward aqua for foliage.
- To calm a tungsten orange cast, correct temperature first; use orange saturation -.15 to -.3 only if skin still looks sunburned.
- teal-orange and golden-hour push skin warmer; cap them at .7 on close-ups of people.
- Mono and bleach-bypass looks remove or crush skin color on purpose; only use them when the user wants that drama.
- After any look, check a close-up face with getFrames. Skin should read as skin, not orange, gray or pink.

## Looks by genre

| Content | Correction focus | Look |
|---|---|---|
| Talking head, podcast, tutorial | Neutral white balance, exposure to a .45 median, contrast 1.05 to 1.1 | film-warm at .3 to .4, or none |
| Vlog, travel, lifestyle | Match all shots first; vibrance +10 to +20 | golden-hour .5 to .7 |
| Cinematic, hype, trailer | Contrast via a master S-curve | teal-orange .6 to .8, bloom .3 on lights |
| Tech, product, SaaS | Clean neutral, slightly cool (temperature -5 to -15) | none, or cool-night at .3 |
| Night, city, neon | Keep blacks deep; never lift shadows | cool-night .5 to .7, bloom .5 to .8 |
| Retro, memory, flashback | Lower contrast | vintage-fade .6 to .8, plus filmOverlay |
| Moody, dramatic, serious | Lower saturation .8 | bleach-bypass .4 to .6, or mono-contrast |
| Beauty, fashion, soft | Soft contrast, protect skin | pastel .4 to .6 |

## Rules

- Grade every clip of one scene identically; matching beats beauty.
- Text, graphics and solids are never graded, only footage and images.
- A look on only one clip of a sequence reads as a mistake unless it marks a deliberate shift (a flashback, a dream, a before/after).
- When a request is vague ("make it look better"), correct only. Add a look only when asked for style, mood or a reference.
- Keyframe a grade change over time with animateEffect (colorGrade.saturation draining to 0 on a sad line, colorGrade.exposure dipping into a transition).
- Explain the grade in plain words (warmer, cooler, more contrast, softer), not in numbers.
`,
};
