import { tableRow, tablePatch } from './lib/exact';
import { runFailure } from '../lib/ai/run-failure';
import { ConvexError, v } from 'convex/values';
import { runArgs } from './lib/active_run';
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { projectRun } from './lib/project_data';

/**
 * Agentic memory for the editing AI, per user:
 * - preferences: short lasting rules ("captions in yellow, top third", "never add sound effects");
 * - styles: edits the user liked or keeps repeating, with the exact recipe (tools and settings) so the AI
 *   can reapply them in any project ("my podcast captions", "the teal grade from the travel vlog").
 * User memories apply everywhere; project memories to one project. Summaries ride in the AI's context each
 * turn, most-used first; a style's full recipe loads on demand (recallMemory) and counts as a use.
 */
export const MAX_USER_MEMORIES = 60, MAX_PROJECT_MEMORIES = 20, MAX_MEMORY_LENGTH = 280, MAX_RECIPE_LENGTH = 6000;
const kind = v.union(v.literal('preference'), v.literal('style'));
const topic = v.union(v.literal('captions'), v.literal('platforms'), v.literal('editing'));
const summary = v.object({ memoryId: v.id('agentMemories'), scope: v.union(v.literal('user'), v.literal('project')), kind, topic: v.optional(topic), name: v.optional(v.string()), text: v.string(), hasRecipe: v.boolean(), source: v.optional(v.string()), uses: v.number() });

/** A source project's title from its catalog row; the project document carries the whole timeline. */
async function sourceTitle(ctx: QueryCtx, projectId: Id<'projects'> | undefined) {
  if (!projectId) return undefined;
  const catalog = await ctx.db.query('projectCatalog').withIndex('by_project', q => q.eq('projectId', projectId)).unique();
  return catalog ? catalog.title : (await ctx.db.get(projectId))?.title;
}
async function view(ctx: QueryCtx, row: Doc<'agentMemories'>) {
  const source = await sourceTitle(ctx, row.sourceProjectId);
  return { memoryId: row._id, scope: row.projectId ? 'project' as const : 'user' as const, kind: row.kind ?? 'preference' as const, ...(row.topic ? { topic: row.topic } : {}), ...(row.name ? { name: row.name } : {}), text: row.text, hasRecipe: !!row.recipe, ...(source ? { source } : {}), uses: row.uses ?? 0 };
}
export async function memoriesFor(ctx: QueryCtx, ownerId: string, projectId?: Id<'projects'>) {
  const user = await ctx.db.query('agentMemories').withIndex('by_owner_project', q => q.eq('ownerId', ownerId).eq('projectId', undefined)).take(MAX_USER_MEMORIES);
  const project = projectId ? await ctx.db.query('agentMemories').withIndex('by_owner_project', q => q.eq('ownerId', ownerId).eq('projectId', projectId)).take(MAX_PROJECT_MEMORIES) : [];
  // Project rules first, then the user's most-used styles and preferences.
  const rank = (row: Doc<'agentMemories'>) => (row.uses ?? 0) * 1e13 + (row.lastUsedAt ?? row.updatedAt);
  return Promise.all([...project.sort((a, b) => rank(b) - rank(a)), ...user.sort((a, b) => rank(b) - rank(a))].map(row => view(ctx, row)));
}
function memoryText(value: string) {
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length < 3 || text.length > MAX_MEMORY_LENGTH) throw new ConvexError(`Keep it between 3 and ${MAX_MEMORY_LENGTH} characters.`);
  return text;
}
async function requireRun(ctx: QueryCtx | MutationCtx, args: { projectId: Id<'projects'>; ownerId: string; runId: string }) {
  const run = await projectRun(ctx, args.projectId, args.ownerId);
  if (run.aiRunId !== args.runId || !run.aiRunning) throw runFailure('locked', 'AI run is no longer active.');
}
async function owned(ctx: QueryCtx, ownerId: string, memoryId: string) {
  const id = ctx.db.normalizeId('agentMemories', memoryId), row = id ? await ctx.db.get(id) : null;
  if (!row || row.ownerId !== ownerId) throw new ConvexError('Memory not found. Use a memoryId from the memories in your context.');
  return row;
}

export const forRun = internalQuery({ args: runArgs, returns: v.array(summary), handler: async (ctx, args) => { await requireRun(ctx, args); return memoriesFor(ctx, args.ownerId, args.projectId); } });

/** Save a preference or style (or, with memoryId, rewrite one). An identical text updates nothing. */
export const remember = internalMutation({
  args: { ...runArgs, text: v.string(), scope: v.union(v.literal('user'), v.literal('project')), kind, topic: v.optional(topic), name: v.optional(v.string()), recipe: v.optional(v.string()), memoryId: v.optional(v.string()) },
  returns: summary,
  handler: async (ctx, args) => {
    await requireRun(ctx, args);
    const text = memoryText(args.text), name = args.name?.trim().slice(0, 60) || undefined, recipe = args.recipe?.trim() || undefined;
    if (recipe && recipe.length > MAX_RECIPE_LENGTH) throw new ConvexError(`Keep the recipe under ${MAX_RECIPE_LENGTH} characters: the settings that make the look, not whole clips.`);
    if (args.kind === 'style' && (!name || !recipe)) throw new ConvexError('A style needs a short name and its recipe (the exact tools and settings).');
    const projectId = args.scope === 'project' ? args.projectId : undefined, now = Date.now();
    const fields = { text, kind: args.kind, ...(args.topic ? { topic: args.topic } : {}), ...(name ? { name } : {}), ...(recipe ? { recipe } : {}), projectId, updatedAt: now };
    if (args.memoryId) {
      const row = await owned(ctx, args.ownerId, args.memoryId);
      await ctx.db.patch(row._id, tablePatch<'agentMemories'>()({ ...fields, name, recipe: recipe ?? row.recipe }));
      return view(ctx, (await ctx.db.get(row._id))!);
    }
    const rows = await ctx.db.query('agentMemories').withIndex('by_owner_project', q => q.eq('ownerId', args.ownerId).eq('projectId', projectId)).take(MAX_USER_MEMORIES + 1);
    const same = rows.find(row => row.text.toLowerCase() === text.toLowerCase() || (name && row.name?.toLowerCase() === name.toLowerCase()));
    if (same) { await ctx.db.patch(same._id, fields); return view(ctx, (await ctx.db.get(same._id))!); }
    if (rows.length >= (projectId ? MAX_PROJECT_MEMORIES : MAX_USER_MEMORIES)) throw new ConvexError('Memory is full. Rewrite or forget an outdated memory first.');
    const memoryId = await ctx.db.insert('agentMemories', tableRow<'agentMemories'>()({ ownerId: args.ownerId, ...fields, ...(args.kind === 'style' ? { sourceProjectId: args.projectId } : {}), uses: 0, createdAt: now }));
    return view(ctx, (await ctx.db.get(memoryId))!);
  },
});

/** A memory's full recipe, counted as a use so the user's go-to styles rank first. */
export const recall = internalMutation({ args: { ...runArgs, memoryId: v.string() }, returns: v.object({ memoryId: v.id('agentMemories'), name: v.optional(v.string()), text: v.string(), recipe: v.optional(v.string()), source: v.optional(v.string()) }), handler: async (ctx, args) => {
  await requireRun(ctx, args);
  const row = await owned(ctx, args.ownerId, args.memoryId);
  await ctx.db.patch(row._id, { uses: (row.uses ?? 0) + 1, lastUsedAt: Date.now() });
  const source = await sourceTitle(ctx, row.sourceProjectId);
  return { memoryId: row._id, ...(row.name ? { name: row.name } : {}), text: row.text, ...(row.recipe ? { recipe: row.recipe } : {}), ...(source ? { source } : {}) };
}});

export const forget = internalMutation({ args: { ...runArgs, memoryId: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  await requireRun(ctx, args);
  await ctx.db.delete((await owned(ctx, args.ownerId, args.memoryId))._id);
  return null;
}});

/** Project deletion removes that project's own memories; styles learned there stay with the user. */
export async function deleteProjectMemories(ctx: MutationCtx, ownerId: string, projectId: Id<'projects'>) {
  const rows = await ctx.db.query('agentMemories').withIndex('by_owner_project', q => q.eq('ownerId', ownerId).eq('projectId', projectId)).take(MAX_PROJECT_MEMORIES + 5);
  for (const row of rows) await ctx.db.delete(row._id);
}
