import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
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
  args: { ...runArgs, name: v.string(), stage: storyboardStage, context: v.string(), promise: v.optional(v.string()), aspectRatio, concepts: v.optional(v.array(storyboardConcept)), chosenConcept: v.optional(v.number()), sheetAssetIds: v.optional(v.array(v.id('assets'))), chosenDirection: v.optional(v.union(v.literal('A'), v.literal('B'))), frameAssetIds: v.optional(v.array(v.id('assets'))), styleAssetIds: v.optional(v.array(v.id('assets'))), animaticTimelineId: v.optional(v.string()), approved: v.literal(true), approvalNote: v.string() },
  returns: approvedStoryboardValidator,
  handler: async (ctx, args) => {
    await requireRun(ctx, args);
    const brief = await row(ctx, args.projectId), previous = brief?.storyboard?.name === args.name ? brief.storyboard : undefined;
    const concepts = args.concepts ?? previous?.concepts;
    const chosenConcept = args.chosenConcept ?? (args.stage === 'concept' && concepts?.length === 1 ? 1 : previous?.chosenConcept);
    if (!concepts || concepts.length < 1 || concepts.length > 3 || !Number.isInteger(chosenConcept) || chosenConcept! < 1 || chosenConcept! > concepts.length) throw new ConvexError('Save the user-approved angle as one concept with chosenConcept 1. Existing multi-concept boards need their chosen concept number.');
    if (concepts.some(concept => 'text' in concept ? !concept.text.trim() || concept.text.trim().split(/\s+/).length > 50 : concept.beats.length < 4 || concept.beats.length > 6)) throw new ConvexError('Keep each concept to a name and at most 50 words of visible actions and exact on-screen text.');
    if (args.stage !== 'concept' && !previous?.chosenConcept) throw new ConvexError('Save the approved text concept before drawing the board.');
    if (args.stage !== 'concept' && args.aspectRatio !== previous?.aspectRatio) throw new ConvexError('Keep the concept’s approved film aspect ratio, or save the revised concept first.');
    const promise = args.promise ?? previous?.promise;
    if (!promise?.trim()) throw new ConvexError('Include the film’s one-sentence promise.');
    const target = dimensions(args.aspectRatio);
    const sheetIds = args.stage === 'concept' ? [] : args.sheetAssetIds ?? previous?.sheetAssetIds ?? [];
    const chosenDirection = args.chosenDirection ?? previous?.chosenDirection;
    type SheetShot = NonNullable<NonNullable<Doc<'assets'>['imageGeneration']>['storyboard']>;
    const sheets: { asset: Doc<'assets'>; shot: SheetShot; sheet: NonNullable<SheetShot['sheet']> }[] = [];
    for (const id of sheetIds) {
      const asset = await ctx.db.get(id), shot = asset?.imageGeneration?.storyboard;
      if (!asset || asset.ownerId !== args.ownerId || asset.projectId !== args.projectId || asset.imageGeneration?.purpose !== 'storyboard' || shot?.phase !== 'sheet' || !shot.sheet || shot.name !== args.name || shot.presented !== true || shot.sheet.panelAspectRatio !== args.aspectRatio) throw new ConvexError('Choose self-checked sheets from this project and board, with panels in the film’s aspect ratio.');
      sheets.push({ asset, shot, sheet: shot.sheet });
    }
    if (sheets.length) {
      if (sheetIds.length > 24 || new Set(sheetIds).size !== sheetIds.length || !chosenDirection) throw new ConvexError('Supply distinct sheets and the user’s chosenDirection A or B.');
      for (const direction of ['A', 'B']) {
        const panels = sheets.flatMap(({ sheet }) => sheet.panels.filter(panel => panel.direction === direction)).sort((a, b) => a.shotIndex - b.shotIndex);
        if (!panels.length && direction !== chosenDirection) continue;
        if (panels.length < 2 || panels.length > 24 || panels.some((panel, index) => panel.shotIndex !== index + 1)) throw new ConvexError('Each supplied direction needs 2–24 consecutively numbered panels, including the chosen direction; each sheet holds at most 8.');
      }
      if (args.stage !== 'direction' && (!previous?.chosenDirection || chosenDirection !== previous.chosenDirection || sheetIds.length !== previous.sheetAssetIds?.length || sheetIds.some(id => !previous.sheetAssetIds!.includes(id)))) throw new ConvexError('Save the user’s sheet pick or revised sheets at stage direction before key frames.');
    } else if (args.stage === 'direction') throw new ConvexError('Save the reviewed A/B sheet asset(s) and the user’s pick.');
    const loadFrames = async (ids: Id<'assets'>[], style: boolean) => {
      if (new Set(ids).size !== ids.length) throw new ConvexError('Choose distinct frames.');
      const frames = [];
      for (const id of ids) {
        const asset = await ctx.db.get(id), shot = asset?.imageGeneration?.storyboard;
        if (!asset || asset.ownerId !== args.ownerId || asset.projectId !== args.projectId || asset.imageGeneration?.purpose !== 'storyboard' || !shot || shot.name !== args.name || shot.presented === false || (style ? shot.phase !== 'style' : !['rough', 'board'].includes(shot.phase ?? 'rough'))) throw new ConvexError('Choose reviewed frames from this project and storyboard stage.');
        if (!asset.width || !asset.height || Math.abs(asset.width / asset.height - target.width / target.height) > .01) throw new ConvexError('Frames must match the target aspect ratio.');
        frames.push({ asset, shot });
      }
      if (style && sheets.length) {
        for (const { asset } of frames) if (!asset.imageGeneration!.referenceAssetIds.some(id => sheets.some(sheet => sheet.asset._id === id && sheet.sheet.panels.some(panel => panel.direction === chosenDirection)))) throw new ConvexError('Reference the chosen direction’s sheet in every key-frame redraw.');
        return frames;
      }
      const anchor = frames[0]?.asset;
      const priorAnchor = style ? previous?.styleAnchorAssetId : previous?.shots[0]?.assetId;
      const anchors = [anchor?._id, priorAnchor].filter((id): id is Id<'assets'> => !!id);
      for (const { asset } of frames.slice(1)) if (!asset.imageGeneration!.referenceAssetIds.some(id => anchors.includes(id))) throw new ConvexError('Pass the first frame of this stage as a reference for the rest.');
      return frames;
    };
    const roughIds = args.stage === 'concept' ? [] : args.frameAssetIds ?? previous?.shots.map(shot => shot.assetId) ?? [];
    if (!sheets.length && args.stage !== 'concept' && (roughIds.length < 3 || roughIds.length > 6)) throw new ConvexError('Save 3–6 rough board frames, or approved direction sheets.');
    const rough = sheets.length ? sheets.flatMap(({ asset, shot, sheet }) => sheet.panels.filter(panel => panel.direction === chosenDirection).map(panel => ({ asset, shot: { ...shot, ...panel } }))) : await loadFrames(roughIds, false);
    rough.sort((a, b) => a.shot.shotIndex - b.shot.shotIndex);
    if (rough.some(({ shot }, index) => shot.shotIndex !== index + 1)) throw new ConvexError('Number rough board frames consecutively from 1.');
    const styleIds = ['style', 'animatic'].includes(args.stage) ? args.styleAssetIds ?? previous?.styleFrames?.map(frame => frame.assetId) ?? [] : [];
    if (['style', 'animatic'].includes(args.stage) && (styleIds.length < 2 || styleIds.length > 3)) throw new ConvexError('Approve 2–3 final-look style frames.');
    const styles = await loadFrames(styleIds, true);
    if (new Set(styles.map(({ shot }) => shot.shotIndex)).size !== styles.length || styles.some(({ shot }) => shot.shotIndex < 1 || shot.shotIndex > rough.length)) throw new ConvexError('Style frames must identify distinct shots in the rough board.');
    if (args.stage === 'style' && !['direction', 'rough', 'style', 'animatic'].includes(previous?.stage ?? '')) throw new ConvexError('Approve the direction sheet before the full-size key frames.');
    const durations = new Map<string, number>();
    if (args.stage === 'animatic') {
      if (!['style', 'animatic'].includes(previous?.stage ?? '') || !args.animaticTimelineId) throw new ConvexError('Approve the style frames and supply the paced animatic timeline.');
      const project = (await ctx.db.get(args.projectId))!, timeline = await storedTabTimeline(ctx, project, args.animaticTimelineId);
      const images = timeline?.clips.filter(clip => clip.kind === 'image').sort((a, b) => a.start - b.start) ?? [];
      if (!timeline || timeline.aspectRatio !== args.aspectRatio || timeline.clips.some(clip => clip.kind === 'scene' || clip.kind === 'video') || images.length !== rough.length || images.some((clip, index) => {
        const frame = rough[index], key = styles.find(({ shot }) => shot.shotIndex === frame.shot.shotIndex);
        if (clip.assetId !== frame.asset._id && clip.assetId !== key?.asset._id || clip.duration <= 0 || Math.abs(clip.start - (index ? images[index - 1].start + images[index - 1].duration : 0)) > .001) return true;
        if (!sheets.length || clip.assetId !== frame.asset._id) return false;
        const sheet = sheets.find(item => item.asset._id === clip.assetId)!, panel = sheet.sheet.panels.find(item => item.direction === chosenDirection && item.shotIndex === frame.shot.shotIndex)!;
        const { left = 0, right = 0, top = 0, bottom = 0 } = clip.crop ?? {};
        const cx = (1 + left - right) / 2, cy = (1 + top - bottom) / 2;
        const ratio = (sheet.asset.width ?? 0) * (1 - left - right) / ((sheet.asset.height ?? 0) * (1 - top - bottom));
        return !clip.crop || Math.abs(ratio / (target.width / target.height) - 1) > .03 || cx <= (panel.column - 1) / sheet.sheet.columns || cx >= panel.column / sheet.sheet.columns || cy <= (panel.row - 1) / sheet.sheet.rows || cy >= panel.row / sheet.sheet.rows;
      })) throw new ConvexError('Pace one image per chosen shot in order, with no gaps, overlaps, scene code or video. Use its approved key frame or crop that shot’s sheet panel to the film ratio; never show a whole sheet as one shot.');
      for (const [index, clip] of images.entries()) durations.set(String(index + 1), clip.duration);
    }
    const now = Date.now();
    const stages = ['concept', 'direction', 'rough', 'style', 'animatic'];
    const selectedConcept = concepts[chosenConcept! - 1];
    const storyboard = {
      name: args.name, context: args.context, promise, aspectRatio: args.aspectRatio, stage: args.stage,
      concepts, chosenConcept: chosenConcept!, ...('look' in selectedConcept ? { direction: selectedConcept.look } : {}),
      ...(sheets.length ? { sheetAssetIds: sheetIds, chosenDirection, directionAssetId: rough[0].asset._id } : {}),
      ...(styles.length ? { styleAnchorAssetId: styles[0].asset._id, styleFrames: styles.map(({ asset, shot }) => ({ assetId: asset._id, shotIndex: shot.shotIndex })) } : {}),
      ...(args.stage === 'animatic' ? { animaticTimelineId: args.animaticTimelineId } : {}),
      approvalNote: args.approvalNote, approvedAt: now,
      approvals: [...(previous?.approvals ?? []).filter(approval => stages.indexOf(approval.stage) < stages.indexOf(args.stage)), { stage: args.stage, note: args.approvalNote, at: now }],
      shots: rough.map(({ asset, shot }) => ({
        shotIndex: shot.shotIndex, assetId: asset._id, idea: shot.idea, visual: shot.visual ?? asset.imageGeneration!.prompt,
        onScreenText: shot.onScreenText ?? '', motion: shot.motion, transition: shot.transition ?? 'Cut to the next shot', assetsNeeded: shot.assetsNeeded ?? [],
        ...(durations.has(String(shot.shotIndex)) || shot.duration !== undefined ? { duration: durations.get(String(shot.shotIndex)) ?? shot.duration } : {}),
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
