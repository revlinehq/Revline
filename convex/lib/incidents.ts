import { tablePatch, tableRow } from './exact';
import { z } from 'zod';
import { v, type Infer } from 'convex/values';
import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { incidentContext, incidentNormalized, incidentText, isIssueFiled, isToolErrorKind, TOOL_ERROR_THRESHOLD, toolErrorIdentity, toolErrorIssueText, toolErrorMessage, type ToolErrorImpact, type ToolErrorReport } from '../../lib/incidents';

export const incidentArgs = {
  source: v.string(), kind: v.string(), message: v.string(), stack: v.optional(v.string()),
  context: v.any(), projectId: v.optional(v.id('projects')), runId: v.optional(v.string()), deployment: v.string(),
  /** Replaces the message/location identity when the caller defines what makes two reports the same (limitations). */
  identity: v.optional(v.array(v.string())),
};
const incidentInput = v.object(incidentArgs);
export function incidentDeployment() { return process.env.CONVEX_CLOUD_URL === 'https://different-gnu-398.convex.cloud' ? 'prod' : 'dev'; }

export async function incidentFingerprint(identity: string[]) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(identity)));
  return `incident-v1-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** `client`: filed from a browser by any signed-in account. Such a row never re-opens a resolved incident, earns no
 * priority bonus, and waits for triage before the fixer or its webhook sees it. */
export async function recordIncident(ctx: MutationCtx, input: Infer<typeof incidentInput>, { client = false }: { client?: boolean } = {}) {
  const scrub = (text: string) => {
    for (const [key, value] of Object.entries(process.env)) if (/SECRET|TOKEN|KEY|PASSWORD/.test(key) && value && value.length >= 8) text = text.replaceAll(value, '[redacted]');
    return text;
  };
  const message = incidentText(scrub(input.message), 2000, input.kind === 'agent-limitation');
  const context = scrub(incidentContext(input.context, input.kind === 'agent-limitation'));
  const diagnostic = z.object({ location: z.string().optional(), toolName: z.string().optional(), taskKind: z.string().optional() }).catch({}).parse(JSON.parse(context));
  const location = diagnostic.location ?? input.stack?.split('\n').find(line => /\bat\b|:\d+:\d+/.test(line)) ?? input.source;
  const fingerprint = await incidentFingerprint(input.identity ?? [incidentNormalized(message), incidentNormalized(location), input.kind, diagnostic.toolName ?? diagnostic.taskKind ?? '']);
  // Agent-filed rows and tool errors are published as issues by their own lease and never reopen or reach the fixer webhook.
  // A limitation is a feature gap for a person to triage and a tool error is counted until it repeats, so neither waits in the fixer's delivery queue.
  const agentFiled = isIssueFiled(input.kind);
  const existing = await ctx.db.query('incidents').withIndex('by_fingerprint', q => q.eq('fingerprint', fingerprint)).unique();
  const now = Date.now();
  const sample = { at: now, context, ...(input.projectId ? { projectId: input.projectId } : {}), ...(input.runId ? { runId: incidentText(input.runId, 150) } : {}) };
  const opens = !existing || (existing.status === 'resolved' && !agentFiled && !client);
  const priority = (!client && (input.kind === 'turn-failure' || input.kind === 'export' || input.kind === 'save-confirmation') ? 1000 : 0) + Math.min(999, (existing?.count ?? 0) + 1);
  const value = {
    source: incidentText(input.source, 100), kind: incidentText(input.kind, 100), message,
    ...(input.stack ? { stack: incidentText(scrub(input.stack), 6000) } : {}),
    deployment: incidentDeployment(), fingerprint, count: (existing?.count ?? 0) + 1,
    firstSeen: existing?.firstSeen ?? now, lastSeen: now, priority,
    samples: [...(existing?.samples ?? []).slice(-3), sample],
  };
  const generation = (existing?.generation ?? 0) + (opens ? 1 : 0);
  const id = existing?._id ?? await ctx.db.insert('incidents', tableRow<'incidents'>()({ ...value, status: 'open', delivery: input.kind === 'agent-limitation' || isToolErrorKind(input.kind) || client ? 'finished' : 'pending', generation, ...(agentFiled ? { issueAttempts: 0 } : {}), ...(client ? { needsTriage: true } : {}) }));
  // A new occurrence gives an exhausted issue delivery a fresh budget; issue bodies are bounded now.
  const issueRetry = agentFiled && (existing?.issueAttempts ?? 0) >= 5 ? { issueAttempts: 0, issueNextAttempt: undefined } : {};
  if (existing) await ctx.db.patch(id, tablePatch<'incidents'>()({ ...value, ...issueRetry, ...(opens ? { status: 'open', delivery: 'pending', generation, claimToken: undefined, claimedAt: undefined, prUrl: undefined, deliveryError: undefined } : {}) }));
  if (opens && !agentFiled && !client && process.env.INCIDENT_WEBHOOK_URL) await ctx.scheduler.runAfter(0, internal.incidentDelivery.webhook, { id, generation });
  return id;
}

/** Filing an incident from a path that ends or cleans up something else (a turn finishing, a stalled export being
 * failed): the report is best effort and never throws, so a recording problem cannot stop that work. */
export async function recordIncidentSafely(ctx: MutationCtx, input: Infer<typeof incidentInput>) {
  try { return await recordIncident(ctx, input); }
  catch (error) {
    console.error(`[incidents] ${JSON.stringify({ event: 'record-failed', kind: input.kind, source: input.source, error: error instanceof Error ? error.message.slice(0, 300) : 'unknown' })}`);
    return null;
  }
}

const shortHash = async (value: string) => (await incidentFingerprint([value])).slice(-16);
const TOOL_ERROR_USERS = 100, TOOL_ERROR_RECENT = 25;
export type ToolErrorScope = { ownerId: string; projectId?: Id<'projects'>; runId?: string; surface: 'editor' | 'mcp'; impact: ToolErrorImpact };
/** Each tool error is one row per identity (lib/incidents.ts). The same error again in the same turn adds no
 * occurrence; a later report from that turn only updates the latest impact (a turn that failed after it). */
export async function recordToolError(ctx: MutationCtx, scope: ToolErrorScope, report: ToolErrorReport, counted = false) {
  const identity = toolErrorIdentity(report), fingerprint = await incidentFingerprint(identity), now = Date.now();
  const user = await shortHash(`${fingerprint}:${scope.ownerId}`), run = scope.runId ? await shortHash(`${fingerprint}:${scope.runId}`) : `once-${crypto.randomUUID().slice(0, 8)}`;
  const existing = await ctx.db.query('incidents').withIndex('by_fingerprint', q => q.eq('fingerprint', fingerprint)).unique();
  // counted: the turn's step report already added this occurrence, even if a busy row has since dropped its run marker.
  if (existing?.toolError && (counted || existing.toolError.recent.some(item => item.run === run))) {
    if (existing.toolError.impact !== scope.impact) await ctx.db.patch(existing._id, { toolError: { ...existing.toolError, impact: scope.impact } });
    return existing._id;
  }
  const id = await recordIncident(ctx, {
    source: scope.surface === 'mcp' ? 'mcp' : 'assistant', kind: report.kind, identity, message: toolErrorMessage(report),
    context: { location: scope.surface === 'mcp' ? 'convex/mcpActions:callTool' : 'editor-turn:step', toolName: report.toolName, condition: report.errorClass, event: scope.impact, ...(report.issues ? { inputShape: toolErrorIssueText(report.issues) } : {}) },
    ...(scope.projectId ? { projectId: scope.projectId } : {}), ...(scope.runId ? { runId: scope.runId } : {}), deployment: incidentDeployment(),
  });
  const previous = existing?.toolError;
  const users = previous?.users.includes(user) ? previous.users : [...(previous?.users ?? []), user].slice(0, TOOL_ERROR_USERS);
  const recent = [...(previous?.recent ?? []).filter(item => item.at > now - TOOL_ERROR_THRESHOLD.windowMs), { at: now, user, run }].slice(-TOOL_ERROR_RECENT);
  await ctx.db.patch(id, { toolError: { impact: scope.impact, surface: scope.surface, users, recent } });
  return id;
}
