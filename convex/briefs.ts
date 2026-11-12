import { ConvexError, v } from 'convex/values';
import { runFailure } from '../lib/ai/run-failure';
import { runArgs } from './lib/active_run';
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { projectRun } from './lib/project_data';
import { READ_ONLY_RUN_PREFIX } from './lib/run_ids';

/**
 * A project's brief: the user's lasting direction for this one project ("the lockup at 6.3 s stays", "no purple
 * fills"), one rule each, with the words the user said it in. Editing agents read it before changing anything and
 * keep it current: a new direction replaces the rule it supersedes instead of piling up beside it.
 */
export const BRIEF_RULES = 40, BRIEF_RULE_LENGTH = 300, BRIEF_WORDS_LENGTH = 600;

async function requireRun(ctx: QueryCtx | MutationCtx, args: { projectId: Id<'projects'>; ownerId: string; runId: string }, reading = false) {
  const run = await projectRun(ctx, args.projectId, args.ownerId);
  if (reading && args.runId.startsWith(READ_ONLY_RUN_PREFIX)) return;
  if (run.aiRunId !== args.runId || !run.aiRunning) throw runFailure('locked', 'AI run is no longer active.');
}
const row = (ctx: QueryCtx, projectId: Id<'projects'>) => ctx.db.query('projectBriefs').withIndex('by_project', q => q.eq('projectId', projectId)).unique();

/** The brief as agents read it: each rule with its id, the user's words and when it was set. */
export async function briefFor(ctx: QueryCtx, projectId: Id<'projects'>) {
  const brief = await row(ctx, projectId);
  return { rules: (brief?.rules ?? []).map(item => ({ ruleId: item.id, rule: item.rule, userWords: item.words, at: new Date(item.at).toISOString() })), ...(brief ? { updatedAt: new Date(brief.updatedAt).toISOString() } : {}) };
}

export const forRun = internalQuery({ args: runArgs, returns: v.any(), handler: async (ctx, args) => { await requireRun(ctx, args, true); return briefFor(ctx, args.projectId); } });

/** Add rules, each replacing the rules it supersedes, and remove rules the user dropped. */
export const update = internalMutation({
  args: { ...runArgs, set: v.array(v.object({ rule: v.string(), words: v.string(), replaces: v.optional(v.array(v.string())) })), remove: v.array(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRun(ctx, args);
    const brief = await row(ctx, args.projectId), project = (await ctx.db.get(args.projectId))!;
    let rules = brief?.rules ?? [];
    const known = new Set(rules.map(item => item.id)), unknown = [...args.remove, ...args.set.flatMap(item => item.replaces ?? [])].filter(id => !known.has(id));
    if (unknown.length) throw new ConvexError(`No brief rule ${unknown.join(', ')}. Use ruleIds from readBrief.`);
    const replaced = new Set([...args.remove, ...args.set.flatMap(item => item.replaces ?? [])]);
    rules = rules.filter(item => !replaced.has(item.id));
    for (const item of args.set) {
      const text = item.rule.trim().replace(/\s+/g, ' '), words = item.words.trim();
      if (text.length < 3 || text.length > BRIEF_RULE_LENGTH) throw new ConvexError(`Keep each rule between 3 and ${BRIEF_RULE_LENGTH} characters.`);
      if (!words || words.length > BRIEF_WORDS_LENGTH) throw new ConvexError(`Quote the user's own words for each rule (up to ${BRIEF_WORDS_LENGTH} characters).`);
      // The same rule said again keeps one entry, with the latest words.
      rules = [...rules.filter(other => other.rule.toLowerCase() !== text.toLowerCase()), { id: crypto.randomUUID().slice(0, 8), rule: text, words, at: Date.now() }];
    }
    if (rules.length > BRIEF_RULES) throw new ConvexError(`A brief holds up to ${BRIEF_RULES} rules. Merge or replace older rules (replaces) instead of adding more.`);
    if (brief) await ctx.db.patch(brief._id, { rules, updatedAt: Date.now() });
    else await ctx.db.insert('projectBriefs', { projectId: args.projectId, ownerId: project.ownerId, rules, updatedAt: Date.now() });
    return briefFor(ctx, args.projectId);
  },
});
