import { v } from 'convex/values';
import { internalQuery, query } from './_generated/server';
import { requireOwner } from './lib/auth';
import { aiUsageRefusal, aiUsageState, storageState } from './lib/plan_limits';
import { billingEnabled, limitsPlan } from './lib/billing_access';

const tier = v.union(v.literal('starter'), v.literal('pro'), v.literal('studio'));
/** The signed-in owner's plan meters: storage against the plan's limit, and AI usage as a share of the period's
 *  allowance (never dollars). Null fields mean no limit applies (billing off, or no plan). */
export const status = query({
  args: {},
  returns: v.object({
    tier: v.union(tier, v.null()),
    /** A free trial: the meters run against the trial's limits until the first payment, and no upgrade raises them. */
    trial: v.optional(v.boolean()),
    storage: v.object({ usedBytes: v.number(), reservedBytes: v.number(), limitBytes: v.union(v.number(), v.null()) }),
    ai: v.union(v.null(), v.object({ used: v.number(), today: v.union(v.number(), v.null()), blocked: v.union(v.literal('month'), v.literal('day'), v.null()), resetsAt: v.number(), dayResetsAt: v.number() })),
  }),
  handler: async (ctx) => {
    const ownerId = await requireOwner(ctx);
    // A free trial's meters run against its trial limits; `tier` stays the plan being trialed.
    const plan = billingEnabled() ? await limitsPlan(ctx, ownerId) : null;
    const { usedBytes, reservedBytes, limitBytes } = await storageState(ctx, ownerId, plan);
    const ai = await aiUsageState(ctx, ownerId, plan);
    return { tier: plan?.trialOf ?? plan?.tier ?? null, ...(plan?.trialOf ? { trial: true } : {}), storage: { usedBytes, reservedBytes, limitBytes }, ai: ai && { used: ai.used, today: ai.today, blocked: ai.blocked, resetsAt: ai.resetsAt, dayResetsAt: ai.dayResetsAt } };
  },
});

/** For MCP model tools: the message refusing a call past the plan's AI allowance, or null. */
/** Also read by a running turn before each model step (lib/editorTurn.ts prepareStep). */
export const aiRefusal = internalQuery({ args: { ownerId: v.string() }, returns: v.union(v.string(), v.null()), handler: async (ctx, args) => (await aiUsageRefusal(ctx, args.ownerId))?.message ?? null });
