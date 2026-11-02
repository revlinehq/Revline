import { z } from 'zod';
import { v, type Infer } from 'convex/values';
import type { MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { incidentContext, incidentNormalized, incidentText } from '../../lib/incidents';

export const incidentArgs = {
  source: v.string(), kind: v.string(), message: v.string(), stack: v.optional(v.string()),
  context: v.any(), projectId: v.optional(v.id('projects')), runId: v.optional(v.string()), deployment: v.string(),
};
const incidentInput = v.object(incidentArgs);
export function incidentDeployment() { return process.env.CONVEX_CLOUD_URL === 'https://different-gnu-398.convex.cloud' ? 'prod' : 'dev'; }

export async function recordIncident(ctx: MutationCtx, input: Infer<typeof incidentInput>) {
  const scrub = (text: string) => {
    for (const [key, value] of Object.entries(process.env)) if (/SECRET|TOKEN|KEY|PASSWORD/.test(key) && value && value.length >= 8) text = text.replaceAll(value, '[redacted]');
    return text;
  };
  const message = incidentText(scrub(input.message));
  const context = scrub(incidentContext(input.context));
  const diagnostic = z.object({ location: z.string().optional(), toolName: z.string().optional(), taskKind: z.string().optional() }).catch({}).parse(JSON.parse(context));
  const location = diagnostic.location ?? input.stack?.split('\n').find(line => /\bat\b|:\d+:\d+/.test(line)) ?? input.source;
  const identity = [incidentNormalized(message), incidentNormalized(location), input.kind, diagnostic.toolName ?? diagnostic.taskKind ?? ''];
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(identity)));
  const fingerprint = `incident-v1-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  const existing = await ctx.db.query('incidents').withIndex('by_fingerprint', q => q.eq('fingerprint', fingerprint)).unique();
  const now = Date.now();
  const sample = { at: now, context, ...(input.projectId ? { projectId: input.projectId } : {}), ...(input.runId ? { runId: incidentText(input.runId, 150) } : {}) };
  const opens = !existing || existing.status === 'resolved';
  const priority = (input.kind === 'turn-failure' || input.kind === 'export' || input.kind === 'save-confirmation' ? 1000 : 0) + Math.min(999, (existing?.count ?? 0) + 1);
  const value = {
    source: incidentText(input.source, 100), kind: incidentText(input.kind, 100), message,
    ...(input.stack ? { stack: incidentText(scrub(input.stack), 6000) } : {}),
    deployment: incidentDeployment(), fingerprint, count: (existing?.count ?? 0) + 1,
    firstSeen: existing?.firstSeen ?? now, lastSeen: now, priority,
    samples: [...(existing?.samples ?? []).slice(-3), sample],
  };
  const generation = (existing?.generation ?? 0) + (opens ? 1 : 0);
  const id = existing?._id ?? await ctx.db.insert('incidents', { ...value, status: 'open', delivery: 'pending', generation });
  if (existing) await ctx.db.patch(id, { ...value, ...(opens ? { status: 'open', delivery: 'pending', generation, claimToken: undefined, claimedAt: undefined, prUrl: undefined, deliveryError: undefined } : {}) });
  if (opens && process.env.INCIDENT_WEBHOOK_URL) await ctx.scheduler.runAfter(0, internal.incidentDelivery.webhook, { id, generation });
  return id;
}
