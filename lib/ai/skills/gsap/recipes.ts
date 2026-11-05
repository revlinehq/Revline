import { skillText, skillDocument } from '../documents';
import type { EditorSkillPage } from '../index';

// Revline's transition recipes: the moves launch films are made of, each as a short useTimeline snippet on the frame clock.
// A motion log names each moment's transition type; the type picks the recipe here.


const letterReveal = skillDocument("gsap/references/recipe-letter-reveal.md");

const writeOn = skillDocument("gsap/references/recipe-write-on.md");

const maskWipe = skillDocument("gsap/references/recipe-mask-wipe.md");

const blurIn = skillDocument("gsap/references/recipe-blur-in.md");

const morph = skillDocument("gsap/references/recipe-morph.md");

const typing = skillDocument("gsap/references/recipe-typing.md");

const flyOff = skillDocument("gsap/references/recipe-fly-off.md");

const transitionsIndex: EditorSkillPage = {
  name: skillDocument("gsap/references/transitions.md").name,
  description: skillDocument("gsap/references/transitions.md").description,
  body: skillText("gsap/references/transitions.md"),
};

export const TRANSITION_RECIPE_PAGES: EditorSkillPage[] = [transitionsIndex, letterReveal, writeOn, maskWipe, blurIn, morph, typing, flyOff];
