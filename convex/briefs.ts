import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { projectRun } from './lib/project_data';
import { READ_ONLY_RUN_PREFIX } from './lib/run_ids';
import { approvedStoryboardValidator, aspectRatio } from './schema';
import { dimensions } from '../lib/editor/types';

/**
 * A project's brief: the user's lasting direction for this one project ("the lockup at 6.3 s stays", "no purple
 * fills"), one rule each, with the words the user said it in. Editing agents read it before changing anything and
 * keep it current: a new direction replaces the rule it supersedes instead of piling up beside it.
 */
export const BRIEF_RULES = 40, BRIEF_RULE_LENGTH = 300, BRIEF_WORDS_LENGTH = 600;
const runArgs = { projectId: v.id('projects'), ownerId: v.string(), runId: v.string() };

async function requireRun(ctx: QueryCtx | MutationCtx, args: { projectId: Id<'projects'>; ownerId: string; runId: string }, reading = false) {
  const run = await projectRun(ctx, args.projectId, args.ownerId);
  if (reading && args.runId.startsWith(READ_ONLY_RUN_PREFIX)) return;
  if (run.aiRunId !== args.runId || !run.aiRunning) throw new ConvexError('AI run is no longer active');
}
const row = (ctx: QueryCtx, projectId: Id<'projects'>) => ctx.db.query('projectBriefs').withIndex('by_project', q => q.eq('projectId', projectId)).unique();

/** The brief as agents read it: each rule with its id, the user's words and when it was set. */
export async function briefFor(ctx: QueryCtx, projectId: Id<'projects'>) {
  const brief = await row(ctx, projectId);
  return { rules: (brief?.rules ?? []).map(item => ({ ruleId: item.id, rule: item.rule, userWords: item.words, at: new Date(item.at).toISOString() })), ...(brief?.storyboard ? { storyboard: brief.storyboard } : {}), ...(brief ? { updatedAt: new Date(brief.updatedAt).toISOString() } : {}) };
}

/** The approved handoff lives beside the brief, so later sessions read it before building. */
export const saveStoryboard = internalMutation({
  args: { ...runArgs, name: v.string(), direction: v.string(), context: v.string(), aspectRatio, directionAssetId: v.id('assets'), frameAssetIds: v.array(v.id('assets')), approved: v.literal(true), approvalNote: v.string() },
  returns: approvedStoryboardValidator,
  handler: async (ctx, args) => {
    await requireRun(ctx, args);
    if (args.frameAssetIds.length < 3 || args.frameAssetIds.length > 6 || new Set(args.frameAssetIds).size !== args.frameAssetIds.length) throw new ConvexError('Save 3–6 distinct storyboard key frames.');
    const direction = await ctx.db.get(args.directionAssetId);
    if (!direction || direction.kind !== 'image' || direction.ownerId !== args.ownerId || direction.projectId !== args.projectId || direction.imageGeneration?.storyboard?.phase !== 'direction' || direction.imageGeneration.storyboard.name !== args.name) throw new ConvexError('Choose a direction image from this project and named storyboard.');
    const frames = [];
    for (const id of args.frameAssetIds) {
      const asset = await ctx.db.get(id), shot = asset?.imageGeneration?.storyboard;
      if (!asset || asset.ownerId !== args.ownerId || asset.projectId !== args.projectId || asset.imageGeneration?.purpose !== 'storyboard' || !shot || shot.phase === 'direction' || shot.name !== args.name) throw new ConvexError('Every frame must belong to this project and named storyboard.');
      frames.push({ asset, shot });
    }
    frames.sort((a, b) => a.shot.shotIndex - b.shot.shotIndex);
    const anchor = frames[0].asset;
    const target = dimensions(args.aspectRatio);
    if (!anchor.width || !anchor.height || Math.abs(anchor.width / anchor.height - target.width / target.height) > .01) throw new ConvexError('The approved frames must match the target aspect ratio.');
    for (const [index, { asset, shot }] of frames.entries()) {
      if (shot.shotIndex !== index + 1) throw new ConvexError('Number the approved frames consecutively from 1.');
      if (index && !asset.imageGeneration!.referenceAssetIds.includes(anchor._id)) throw new ConvexError('Pass frame 1 as a reference when generating every later board frame.');
      if (asset.width !== anchor.width || asset.height !== anchor.height) throw new ConvexError('Keep one target aspect ratio across the board.');
    }
    const storyboard = { name: args.name, direction: args.direction, context: args.context, aspectRatio: args.aspectRatio, directionAssetId: direction._id, styleAnchorAssetId: anchor._id, approvalNote: args.approvalNote, approvedAt: Date.now(), shots: frames.map(({ asset, shot }) => ({ shotIndex: shot.shotIndex, assetId: asset._id, idea: shot.idea, visual: shot.visual ?? asset.imageGeneration!.prompt, onScreenText: shot.onScreenText ?? '', motion: shot.motion, transition: shot.transition ?? 'Cut to the next shot', assetsNeeded: shot.assetsNeeded ?? [] })) };
    const brief = await row(ctx, args.projectId);
    if (brief) await ctx.db.patch(brief._id, { storyboard, updatedAt: Date.now() });
    else await ctx.db.insert('projectBriefs', { projectId: args.projectId, ownerId: args.ownerId, rules: [], storyboard, updatedAt: Date.now() });
    return storyboard;
  },
});

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
