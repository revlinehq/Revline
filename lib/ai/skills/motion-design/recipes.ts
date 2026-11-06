import { skillText, skillDocument } from '../documents';
import type { EditorSkillPage } from '../types';

// Revline's transition recipes: the moves launch films are made of, each as a short snippet of plain `tl` code on the frame clock.
// A motion log names each moment's transition type; the type picks the recipe here.


const letterReveal = skillDocument("motion-design/references/recipe-letter-reveal.md");

const writeOn = skillDocument("motion-design/references/recipe-write-on.md");

const maskWipe = skillDocument("motion-design/references/recipe-mask-wipe.md");

const blurIn = skillDocument("motion-design/references/recipe-blur-in.md");

const morph = skillDocument("motion-design/references/recipe-morph.md");

const typing = skillDocument("motion-design/references/recipe-typing.md");

const flyOff = skillDocument("motion-design/references/recipe-fly-off.md");

const transitionsIndex: EditorSkillPage = {
  name: skillDocument("motion-design/references/transitions.md").name,
  description: skillDocument("motion-design/references/transitions.md").description,
  body: skillText("motion-design/references/transitions.md"),
};

export const TRANSITION_RECIPE_PAGES: EditorSkillPage[] = [transitionsIndex, letterReveal, writeOn, maskWipe, blurIn, morph, typing, flyOff];
