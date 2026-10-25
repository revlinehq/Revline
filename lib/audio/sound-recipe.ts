import { z } from 'zod';
import { SOUND_PRESET_NAMES } from './presets';

/** Bounds keep one render small and fast enough for an assistant tool call. */
export const SOUND_RECIPE_LIMITS = { duration: 10, layers: 24, layerSeconds: 10, reverbs: 8, recipeChars: 20_000 } as const;

const time = z.number().min(0).max(SOUND_RECIPE_LIMITS.duration);
/** A constant, a from→to glide over the layer (shape exponential by default for frequencies), or {time, value} points in layer seconds. */
export const curveInput = z.union([
  z.number(),
  z.object({ from: z.number(), to: z.number(), shape: z.enum(['linear', 'exponential']).optional(), power: z.number().min(.1).max(10).optional() }).strict(),
  z.object({ points: z.array(z.object({ time, value: z.number() }).strict()).min(2).max(32) }).strict(),
]);
const reverbInput = z.object({ decay: z.number().min(.1).max(4), wet: z.number().min(0).max(1).optional(), bright: z.number().min(500).max(16000).optional() }).strict();
const delayInput = z.object({ time: z.number().min(.02).max(1), feedback: z.number().min(0).max(.9).optional(), wet: z.number().min(0).max(1).optional(), taps: z.number().int().min(1).max(8).optional() }).strict();
const filterInput = z.object({ type: z.enum(['lowpass', 'highpass', 'bandpass']), frequency: curveInput, q: z.number().min(.3).max(20).optional() }).strict();
const layerFields = {
  at: time,
  gain: z.number().min(-48).max(12).optional(),
  pan: curveInput.optional(),
  filters: z.array(filterInput).max(4).optional(),
  distortion: z.number().min(0).max(10).optional(),
  delay: delayInput.optional(),
  reverb: reverbInput.optional(),
};
const presetLayer = z.object({ ...layerFields, preset: z.enum(SOUND_PRESET_NAMES), params: z.object({}).catchall(z.union([z.number(), z.string(), z.boolean()])).optional() }).strict();
const synthLayer = z.object({
  ...layerFields,
  source: z.enum(['sine', 'triangle', 'square', 'saw', 'white', 'pink']),
  length: z.number().min(.005).max(SOUND_RECIPE_LIMITS.layerSeconds),
  frequency: curveInput.optional(),
  partials: z.array(z.object({ ratio: z.number().min(.1).max(32), gain: z.number().min(0).max(2), decay: z.number().min(.001).max(10).optional() }).strict()).min(1).max(12).optional(),
  fm: z.object({ ratio: z.number().min(.1).max(16), index: curveInput }).strict().optional(),
  envelope: z.object({ attack: z.number().min(0).max(5).optional(), hold: z.number().min(0).max(10).optional(), decay: z.number().min(.001).max(10).optional(), release: z.number().min(0).max(5).optional() }).strict().optional(),
  tremolo: z.object({ rate: curveInput, depth: z.number().min(0).max(1) }).strict().optional(),
  seed: z.number().int().min(0).max(1_000_000).optional(),
}).strict();
export const soundRecipeInput = z.object({
  duration: z.number().min(.03).max(SOUND_RECIPE_LIMITS.duration),
  layers: z.array(z.union([presetLayer, synthLayer])).min(1).max(SOUND_RECIPE_LIMITS.layers),
  reverb: reverbInput.optional(),
}).strict();
export type SoundRecipe = z.infer<typeof soundRecipeInput>;
export type SoundLayer = SoundRecipe['layers'][number];
export type Curve = z.infer<typeof curveInput>;

/** Validate stored or model-written JSON; the message lists each problem path. */
export function parseSoundRecipe(value: unknown): SoundRecipe {
  const parsed = soundRecipeInput.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid sound recipe: ${parsed.error.issues.slice(0, 8).map(issue => `${issue.path.join('.') || 'recipe'} ${issue.message}`).join('; ')}`);
  const recipe = parsed.data;
  if (JSON.stringify(recipe).length > SOUND_RECIPE_LIMITS.recipeChars) throw new Error('Sound recipe is too large.');
  const reverbs = recipe.layers.filter(layer => layer.reverb).length + (recipe.reverb ? 1 : 0);
  if (reverbs > SOUND_RECIPE_LIMITS.reverbs) throw new Error(`Use at most ${SOUND_RECIPE_LIMITS.reverbs} reverbs; share one recipe-level reverb instead.`);
  for (const [index, layer] of recipe.layers.entries()) {
    if (layer.at >= recipe.duration) throw new Error(`layers.${index}.at ${layer.at} s starts after the ${recipe.duration} s recipe ends.`);
    if ('source' in layer && layer.source !== 'white' && layer.source !== 'pink' && layer.frequency === undefined) throw new Error(`layers.${index} needs a frequency for a ${layer.source} oscillator.`);
    if ('source' in layer && layer.partials && layer.source !== 'sine') throw new Error(`layers.${index}.partials only apply to a sine source.`);
  }
  return recipe;
}
