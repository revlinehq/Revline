import { v } from 'convex/values';

/** Mirrors CutoutEffect in lib/editor/cutout-effects.ts. */
export const cutoutEffectValidator = v.object({
  kind: v.union(v.literal('text-behind'), v.literal('backdrop'), v.literal('outline'), v.literal('color-pop'), v.literal('spotlight'), v.literal('blur')),
  text: v.optional(v.string()),
  color: v.optional(v.string()),
});
