import { v } from 'convex/values';

/** Retired Fast/Precise choice. Older queue rows, turns, runner checkpoints and clients still carry it; it validates and is ignored. */
export const editorEditModeValidator = v.union(v.literal('auto'), v.literal('fast'), v.literal('precise'));
