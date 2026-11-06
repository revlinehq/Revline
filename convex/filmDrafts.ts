import { v } from 'convex/values';
import { internalMutation, query, type MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { clipValidator } from './schema';
import { runArgs, holdsRun } from './lib/active_run';
import { projectRun } from './lib/project_data';
import { requireOwner } from './lib/auth';

// A film the editor agent is still writing, shown live in the editor while addFilm or patchScene input streams.
// It lives in its own small row so the large, frequently rewritten code never touches the project or timeline rows
// the editor reads reactively (docs/database-io.md). It is never a revision, an edit or an export.
const section = v.object({ title: v.string(), start: v.number(), duration: v.number() });
const draftFields = { timelineId: v.string(), tool: v.union(v.literal('addFilm'), v.literal('patchScene')), title: v.string(), start: v.number(), duration: v.number(), clip: v.optional(clipValidator), sections: v.array(section), writing: v.optional(section), planned: v.array(section) };

export async function clearFilmDrafts(ctx: MutationCtx, projectId: Id<'projects'>) {
  for (const row of await ctx.db.query('filmDrafts').withIndex('by_project', q => q.eq('projectId', projectId)).take(8)) await ctx.db.delete(row._id);
}

/** The runner's latest renderable cut of the film it is writing; dropped when the run no longer holds the project. */
export const publish = internalMutation({ args: { ...runArgs, draft: v.object(draftFields) }, returns: v.null(), handler: async (ctx, { projectId, ownerId, runId, draft }) => {
  const run = await projectRun(ctx, projectId, ownerId).catch(() => null);
  if (!run || !holdsRun(run, runId)) return null;
  const values = { projectId, ownerId, runId, ...draft, updatedAt: Date.now() };
  const previous = await ctx.db.query('filmDrafts').withIndex('by_project', q => q.eq('projectId', projectId)).first();
  if (previous) await ctx.db.replace(previous._id, values); else await ctx.db.insert('filmDrafts', values);
  return null;
} });

/** The tool call landed or failed: the saved timeline takes over. */
export const clear = internalMutation({ args: runArgs, returns: v.null(), handler: async (ctx, { projectId, ownerId, runId }) => {
  for (const row of await ctx.db.query('filmDrafts').withIndex('by_project', q => q.eq('projectId', projectId)).take(8)) if (row.ownerId === ownerId && row.runId === runId) await ctx.db.delete(row._id);
  return null;
} });

/** The draft the open editor shows, only while the run that wrote it still holds the project. */
export const forProject = query({ args: { projectId: v.id('projects') }, returns: v.union(v.null(), v.object({ ...draftFields, runId: v.string(), updatedAt: v.number() })), handler: async (ctx, { projectId }) => {
  const ownerId = await requireOwner(ctx);
  const run = await projectRun(ctx, projectId, ownerId).catch(() => null);
  if (!run?.aiRunning || !run.aiRunId) return null;
  const draft = await ctx.db.query('filmDrafts').withIndex('by_project', q => q.eq('projectId', projectId)).first();
  if (!draft || draft.ownerId !== ownerId || draft.runId !== run.aiRunId) return null;
  const { _id, _creationTime, projectId: _, ownerId: __, ...result } = draft;
  return result;
} });
