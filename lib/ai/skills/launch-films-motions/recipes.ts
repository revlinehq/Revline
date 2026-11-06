import { skillText, skillDocument } from '../documents';
import type { EditorSkillPage } from '../types';

// Revline's transition recipes: the moves launch films are made of, each as a short snippet of plain `tl` code on the frame clock.
// A motion log names each moment's transition type; the type picks the recipe here.


const letterReveal = skillDocument("launch-films-motions/references/recipe-letter-reveal.md");

const writeOn = skillDocument("launch-films-motions/references/recipe-write-on.md");

const maskWipe = skillDocument("launch-films-motions/references/recipe-mask-wipe.md");

const blurIn = skillDocument("launch-films-motions/references/recipe-blur-in.md");

const morph = skillDocument("launch-films-motions/references/recipe-morph.md");

const typing = skillDocument("launch-films-motions/references/recipe-typing.md");

const flyOff = skillDocument("launch-films-motions/references/recipe-fly-off.md");

const transitionsIndex: EditorSkillPage = {
  name: skillDocument("launch-films-motions/references/transitions.md").name,
  description: skillDocument("launch-films-motions/references/transitions.md").description,
  body: skillText("launch-films-motions/references/transitions.md"),
};

export const TRANSITION_RECIPE_PAGES: EditorSkillPage[] = [transitionsIndex, letterReveal, writeOn, maskWipe, blurIn, morph, typing, flyOff];
