import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { projectRun } from './lib/project_data';
import { READ_ONLY_RUN_PREFIX } from './lib/run_ids';
import { approvedStoryboardValidator, aspectRatio, storyboardConcept, storyboardStage } from './schema';
import { dimensions } from '../lib/editor/types';
import { storedTabTimeline } from './timelineTabs';

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
  args: { ...runArgs, name: v.string(), stage: storyboardStage, context: v.string(), promise: v.optional(v.string()), aspectRatio, concepts: v.optional(v.array(storyboardConcept)), chosenConcept: v.optional(v.number()), frameAssetIds: v.optional(v.array(v.id('assets'))), styleAssetIds: v.optional(v.array(v.id('assets'))), animaticTimelineId: v.optional(v.string()), approved: v.literal(true), approvalNote: v.string() },
  returns: approvedStoryboardValidator,
  handler: async (ctx, args) => {
    await requireRun(ctx, args);
    const brief = await row(ctx, args.projectId), previous = brief?.storyboard?.name === args.name ? brief.storyboard : undefined;
    const concepts = args.concepts ?? previous?.concepts, chosenConcept = args.chosenConcept ?? previous?.chosenConcept;
    if (!concepts || concepts.length < 2 || concepts.length > 3 || !Number.isInteger(chosenConcept) || chosenConcept! < 1 || chosenConcept! > concepts.length) throw new ConvexError('Save 2 concepts (optionally a third wildcard) and the user’s chosen concept number.');
    if (concepts.some(concept => concept.beats.length < 4 || concept.beats.length > 6)) throw new ConvexError('Keep each concept to 4–6 one-line shot beats.');
    if (args.stage !== 'concept' && !previous?.chosenConcept) throw new ConvexError('Save the approved text concept before drawing the board.');
    const promise = args.promise ?? previous?.promise;
    if (!promise?.trim()) throw new ConvexError('Include the film’s one-sentence promise.');
    const target = dimensions(args.aspectRatio);
    const loadFrames = async (ids: Id<'assets'>[], style: boolean) => {
      if (new Set(ids).size !== ids.length) throw new ConvexError('Choose distinct frames.');
      const frames = [];
      for (const id of ids) {
        const asset = await ctx.db.get(id), shot = asset?.imageGeneration?.storyboard;
        if (!asset || asset.ownerId !== args.ownerId || asset.projectId !== args.projectId || asset.imageGeneration?.purpose !== 'storyboard' || !shot || shot.name !== args.name || shot.presented === false || (style ? shot.phase !== 'style' : !['rough', 'board'].includes(shot.phase ?? 'rough'))) throw new ConvexError('Choose reviewed frames from this project and storyboard stage.');
        if (!asset.width || !asset.height || Math.abs(asset.width / asset.height - target.width / target.height) > .01) throw new ConvexError('Frames must match the target aspect ratio.');
        frames.push({ asset, shot });
      }
      const anchor = frames[0]?.asset;
      for (const { asset } of frames.slice(1)) if (!asset.imageGeneration!.referenceAssetIds.includes(anchor._id)) throw new ConvexError('Pass the first frame of this stage as a reference for the rest.');
      return frames;
    };
    const roughIds = args.stage === 'concept' ? [] : args.frameAssetIds ?? previous?.shots.map(shot => shot.assetId) ?? [];
    if (args.stage !== 'concept' && (roughIds.length < 3 || roughIds.length > 6)) throw new ConvexError('Save 3–6 rough board frames.');
    const rough = await loadFrames(roughIds, false);
    rough.sort((a, b) => a.shot.shotIndex - b.shot.shotIndex);
    if (rough.some(({ shot }, index) => shot.shotIndex !== index + 1)) throw new ConvexError('Number rough board frames consecutively from 1.');
    const styleIds = ['style', 'animatic'].includes(args.stage) ? args.styleAssetIds ?? previous?.styleFrames?.map(frame => frame.assetId) ?? [] : [];
    if (['style', 'animatic'].includes(args.stage) && (styleIds.length < 2 || styleIds.length > 3)) throw new ConvexError('Approve 2–3 final-look style frames.');
    const styles = await loadFrames(styleIds, true);
    if (new Set(styles.map(({ shot }) => shot.shotIndex)).size !== styles.length || styles.some(({ shot }) => shot.shotIndex < 1 || shot.shotIndex > rough.length)) throw new ConvexError('Style frames must identify distinct shots in the rough board.');
    if (args.stage === 'style' && !['rough', 'style', 'animatic'].includes(previous?.stage ?? '')) throw new ConvexError('Approve the rough board before the style frames.');
    const durations = new Map<string, number>();
    if (args.stage === 'animatic') {
      if (!['style', 'animatic'].includes(previous?.stage ?? '') || !args.animaticTimelineId) throw new ConvexError('Approve the style frames and supply the paced animatic timeline.');
      const project = (await ctx.db.get(args.projectId))!, timeline = await storedTabTimeline(ctx, project, args.animaticTimelineId);
      const images = timeline?.clips.filter(clip => clip.kind === 'image').sort((a, b) => a.start - b.start) ?? [];
      if (!timeline || timeline.aspectRatio !== args.aspectRatio || timeline.clips.some(clip => clip.kind === 'scene' || clip.kind === 'video') || images.length !== rough.length || images.some((clip, index) => clip.assetId !== rough[index].asset._id || clip.duration <= 0 || Math.abs(clip.start - (index ? images[index - 1].start + images[index - 1].duration : 0)) > .001)) throw new ConvexError('The animatic must contain the rough frames in shot order at the target format, with positive durations, no gaps or overlaps, and no scene code or video.');
      for (const clip of images) durations.set(clip.assetId!, clip.duration);
    }
    const now = Date.now();
    const stages = ['concept', 'rough', 'style', 'animatic'];
    const storyboard = {
      name: args.name, context: args.context, promise, aspectRatio: args.aspectRatio, stage: args.stage,
      concepts, chosenConcept: chosenConcept!, direction: concepts[chosenConcept! - 1].look,
      ...(styles.length ? { styleAnchorAssetId: styles[0].asset._id, styleFrames: styles.map(({ asset, shot }) => ({ assetId: asset._id, shotIndex: shot.shotIndex })) } : {}),
      ...(args.stage === 'animatic' ? { animaticTimelineId: args.animaticTimelineId } : {}),
      approvalNote: args.approvalNote, approvedAt: now,
      approvals: [...(previous?.approvals ?? []).filter(approval => stages.indexOf(approval.stage) < stages.indexOf(args.stage)), { stage: args.stage, note: args.approvalNote, at: now }],
      shots: rough.map(({ asset, shot }) => ({
        shotIndex: shot.shotIndex, assetId: asset._id, idea: shot.idea, visual: shot.visual ?? asset.imageGeneration!.prompt,
        onScreenText: shot.onScreenText ?? '', motion: shot.motion, transition: shot.transition ?? 'Cut to the next shot', assetsNeeded: shot.assetsNeeded ?? [],
        ...(durations.has(asset._id) || shot.duration !== undefined ? { duration: durations.get(asset._id) ?? shot.duration } : {}),
      })),
    };
    if (brief) await ctx.db.patch(brief._id, { storyboard, updatedAt: now });
    else await ctx.db.insert('projectBriefs', { projectId: args.projectId, ownerId: args.ownerId, rules: [], storyboard, updatedAt: now });
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
