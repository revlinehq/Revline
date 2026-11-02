import { v } from 'convex/values';
import type { MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';

export const saveIncidentCondition = v.union(v.literal('missing_save_evidence'), v.literal('staged_without_receipt'), v.literal('staged_revision_missing'), v.literal('staged_receipt_mismatch'));
export const saveIncidentPublication = v.object({ status: v.union(v.literal('saved'), v.literal('failed'), v.literal('aborted')), stagedRevision: v.number(), revision: v.optional(v.number()) });
export const saveIncidentEvidence = {
  projectId: v.id('projects'), runId: v.string(), threadId: v.optional(v.string()), promptMessageId: v.optional(v.string()),
  source: v.union(v.literal('editor'), v.literal('mcp')), toolCallId: v.string(), toolName: v.string(),
  inputShape: v.string(), outputShape: v.string(), revisionBefore: v.number(), revisionAfter: v.number(),
  staged: v.boolean(), stagedRevision: v.optional(v.number()), observedAt: v.number(),
};

/** Shape only: no user text, scene code, URLs, credentials or binary values survive. */
export function incidentShape(value: unknown): string {
  let nodes = 0;
  function shape(item: unknown, depth: number): unknown {
    if (++nodes > 45 || depth > 3) return '[trimmed]';
    if (item === null) return 'null';
    if (typeof item === 'string') return 'string';
    if (typeof item === 'boolean') return item;
    if (typeof item === 'number') return 'number';
    if (Array.isArray(item)) return item.length ? [shape(item[0], depth + 1)] : [];
    if (typeof item !== 'object') return typeof item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(0, 20).map(([key, child]) => {
      const safeKey = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key) ? key : '[key]';
      if (/secret|token|password|authorization|credential|cookie|api.?key|signature|private.?key/i.test(key)) return [safeKey, '[redacted]'];
      if (/^(?:data|image|images|frames|base64|bytes|buffer|code|script|html|url|uri|headers)$/i.test(key)) return [safeKey, '[omitted]'];
      return [safeKey, shape(child, depth + 1)];
    }));
  }
  const result = JSON.stringify(shape(value, 0));
  return result.length <= 1800 ? result : JSON.stringify({ type: Array.isArray(value) ? 'array' : typeof value, shape: '[trimmed]' });
}

export async function finishIncidentRun(ctx: MutationCtx, runId: string, publication?: { status: 'saved' | 'failed' | 'aborted'; stagedRevision: number; revision?: number }) {
  const run = await ctx.db.query('saveIncidentRuns').withIndex('by_run', q => q.eq('runId', runId)).unique();
  if (!run) return;
  await ctx.db.patch(run._id, { finishedAt: Date.now(), ...(publication ? { publication } : {}) });
  await ctx.scheduler.runAfter(0, internal.saveIncidents.settle, { runId });
}

/** Called in the same transaction that saves the timeline and its chat receipt. MCP has no chat receipt. */
export async function publishIncidentRun(ctx: MutationCtx, runId: string, stagedRevision: number, revision: number) {
  const run = await ctx.db.query('saveIncidentRuns').withIndex('by_run', q => q.eq('runId', runId)).unique();
  if (run) await ctx.db.patch(run._id, { publication: { status: 'saved', stagedRevision, revision } });
}
