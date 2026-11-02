import { makeFunctionReference } from 'convex/server';
import { ConvexError, v, type Infer } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { toolBehavior } from '../lib/ai/tool-definitions';
import { toolWriteReceipt } from './lib/tool_write_receipt';
import { projectIdentity } from './lib/project_data';

// Only tool-layer mutations are reachable through the runner's transactional bridge.
const mutations = new Set([
  'assistant:apply', 'assistant:undoLatestEdit', 'assistant:createRunTimeline', 'assistant:openRunTimeline',
  'assistant:beginEditing', 'assistant:previewDraft', 'assistant:requestAnalysis', 'assistant:clearAnalysis',
  'assistant:attachRunStockAudio', 'assistant:saveGeneratedSound', 'assistant:importRunVideo', 'assistant:exportRunVideo',
  'blueprints:requestCheck', 'blueprints:saveFromCheck', 'brandKits:create', 'brandKits:update',
  'compositionReview:savePlan', 'compositionReview:request', 'compositionReview:cancel',
  'cutouts:startFromRun', 'derivations:startFromRun',
  'mcp:requestFrames', 'mcp:requestGuard', 'mcp:discardFrames', 'mcp:takeFrames',
  'briefs:update', 'memories:remember', 'memories:forget',
  'referenceReads:request', 'referenceReads:take', 'referenceReads:discard',
]);
const scope = { projectId: v.id('projects'), ownerId: v.string(), runId: v.string() };

/** The write, revision comparison and receipt commit in one transaction. */
export const run = internalMutation({
  args: { ...scope, toolName: v.string(), writeId: v.string(), functionName: v.string(), input: v.record(v.string(), v.any()) },
  returns: v.object({ value: v.any(), receipt: v.optional(toolWriteReceipt) }),
  handler: async (ctx, args) => {
    const definition = toolBehavior(args.toolName);
    if (!definition || definition.effect === 'read' || definition.effect === 'analysis' || !mutations.has(args.functionName)) throw new ConvexError('This mutation is not registered for editing tools.');
    await projectIdentity(ctx, args.projectId, args.ownerId);
    const existing = await ctx.db.query('toolWriteReceipts').withIndex('by_write', q => q.eq('writeId', args.writeId)).unique();
    if (existing) throw new ConvexError('This write already committed. Read its receipt instead of repeating it.');
    for (const key of ['projectId', 'ownerId', 'runId'] as const) {
      if (args.input[key] !== undefined && args.input[key] !== args[key]) throw new ConvexError('The tool mutation belongs to another run.');
    }
    const before = (await ctx.db.get(args.projectId))?.revision ?? 0;
    let value;
    try {
      value = await ctx.runMutation(makeFunctionReference<'mutation'>(args.functionName), args.input);
      if (value && typeof value === 'object' && (value.success === false || value.isError === true || value.error)) throw new Error(typeof value.error === 'string' ? value.error : 'The mutation rejected this change.');
    }
    catch (error) {
      // A sub-transaction failure rolls back its writes; callers may safely report this as a failed write.
      throw new ConvexError({ kind: 'tool-write-failed', message: (error instanceof Error ? error.message : String(error)).slice(0, 1000) });
    }
    const after = (await ctx.db.get(args.projectId))?.revision ?? before;
    const declared = definition.writes?.includes(args.functionName);
    let receipt: Infer<typeof toolWriteReceipt> | undefined;
    if (after !== before) receipt = { kind: 'timeline', status: 'saved', revision: after };
    else if (declared && definition.effect === 'job') receipt = { kind: 'job', status: 'queued', revision: after };
    else if (declared && definition.effect === 'resource') receipt = { kind: 'resource', status: 'saved', revision: after };
    const stagedRevision = args.functionName === 'assistant:apply' && args.input.stagedPublication === true && typeof args.input.expectedRevision === 'number' ? args.input.expectedRevision : undefined;
    if (receipt) await ctx.db.insert('toolWriteReceipts', { projectId: args.projectId, ownerId: args.ownerId, runId: args.runId, writeId: args.writeId, toolName: args.toolName, functionName: args.functionName, receipt, ...(stagedRevision === undefined ? {} : { stagedRevision }), expiresAt: Date.now() + 86_400_000 });
    return { value, ...(receipt ? { receipt } : {}) };
  },
});

/** A dropped response can be reconciled without replaying the write. */
export const receipt = internalQuery({ args: { ...scope, writeId: v.string() }, returns: v.union(v.null(), toolWriteReceipt), handler: async (ctx, args) => {
  await projectIdentity(ctx, args.projectId, args.ownerId);
  const row = await ctx.db.query('toolWriteReceipts').withIndex('by_write', q => q.eq('writeId', args.writeId)).unique();
  return row && row.ownerId === args.ownerId && row.projectId === args.projectId && row.runId === args.runId ? row.receipt : null;
} });

export const prune = internalMutation({ args: {}, returns: v.null(), handler: async ctx => {
  const expired = await ctx.db.query('toolWriteReceipts').withIndex('by_expires', q => q.lt('expiresAt', Date.now())).take(500);
  for (const row of expired) await ctx.db.delete(row._id);
  return null;
} });
