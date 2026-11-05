import { v } from 'convex/values';
import type { ToolBehavior } from '../../lib/ai/tool-definitions';

/** Read and analysis tools change nothing, so they take no write path and get no save receipt. */
export const savesNothing = (effect: ToolBehavior['effect']): effect is 'read' | 'analysis' => effect === 'read' || effect === 'analysis';

export const toolWriteReceipt = v.union(
  v.object({ kind: v.literal('timeline'), status: v.literal('saved'), revision: v.number() }),
  v.object({ kind: v.literal('resource'), status: v.literal('saved'), revision: v.number() }),
  v.object({ kind: v.literal('job'), status: v.literal('queued'), revision: v.number() }),
);
