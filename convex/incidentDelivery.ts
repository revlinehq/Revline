import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';

export const webhook = internalAction({ args: { id: v.id('incidents'), generation: v.number() }, handler: async (ctx, args) => {
  const url = process.env.INCIDENT_WEBHOOK_URL;
  if (!url) return;
  const row = await ctx.runQuery(internal.incidents.details, { id: args.id });
  if (!row || row.kind === 'agent-report' || row.generation !== args.generation) return;
  const { claimToken: _claimToken, ...payload } = row;
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `${args.id}:${args.generation}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Incident webhook returned ${response.status}`);
} });
