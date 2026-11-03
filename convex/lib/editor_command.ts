import { v } from 'convex/values';

export const editorCommandValidator = v.union(
  v.object({ name: v.literal('clip'), link: v.optional(v.string()), words: v.string() }),
  // Retired /inspo-motion: kept only so runs saved before its removal still validate.
  v.object({ name: v.literal('inspo-motion'), link: v.string(), words: v.string() }),
);
