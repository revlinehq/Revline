import { v } from 'convex/values';

export const editorEditModeValidator = v.union(v.literal('fast'), v.literal('precise'));
