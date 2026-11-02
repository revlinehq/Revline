import { v } from 'convex/values';

export const toolWriteReceipt = v.union(
  v.object({ kind: v.literal('timeline'), status: v.literal('saved'), revision: v.number() }),
  v.object({ kind: v.literal('resource'), status: v.literal('saved'), revision: v.number() }),
  v.object({ kind: v.literal('job'), status: v.literal('queued'), revision: v.number() }),
);
