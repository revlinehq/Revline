import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { processorBackend } from './lib/processor_backend';
import { requireProject } from './lib/auth';
import { commitTimeline } from './lib/timeline';
import { createProjectFor } from './projects';
import { startRenderFor } from './renders';

// The Railway promotion proof: three real jobs (a processing task, a standard export, an Ultra export) on the
// isolated STAGING backend, started by scripts/railway-proof.mjs with the staging deploy key. Their completion is
// what railwayWorkers:releaseEvidence and the promotion receipt verify before production is staged.
//
// This is a service identity, not a user. The owner below is a fixed string no Clerk subject can equal (those are
// `user_…`), it is never an argument, it owns one fixture project that needs no uploaded media, and every function
// here refuses to run anywhere but the isolated staging deployment. No function takes an ownerId or a subject.
const SERVICE_OWNER = 'service_railway-proof'; // R2 keys allow only [A-Za-z0-9_-] in the owner segment; a colon made the media Worker refuse frame-cache writes (403).
const FIXTURE_TITLE = 'Railway promotion proof';

function requireStaging() {
  if (String(process.env.CONVEX_SITE_URL) !== 'https://striped-starling-234.convex.site' || process.env.REVLINE_ISOLATED !== 'true') throw new ConvexError('The promotion proof runs only on the isolated staging backend.');
}
const fixture = async (ctx: QueryCtx | MutationCtx) => (await ctx.db.query('projects').withIndex('by_ownerId_updatedAt', q => q.eq('ownerId', SERVICE_OWNER)).order('desc').take(20)).find(project => !project.deleting && project.title === FIXTURE_TITLE) ?? null;
/** The operator grant the export path reads (lib/billing_access): editing access, and Ultra only while `ultra` is set. */
async function setPlan(ctx: MutationCtx, ultra: boolean) {
  const now = Date.now(), row = await ctx.db.query('editorEntitlements').withIndex('by_owner', q => q.eq('ownerId', SERVICE_OWNER)).unique();
  const fields = { ownerId: SERVICE_OWNER, reason: 'Railway promotion proof (staging service identity)', grantedAt: row?.grantedAt ?? now, updatedAt: now, ...(ultra ? { plan: 'ultra' as const } : {}) };
  if (row) await ctx.db.replace(row._id, fields); else await ctx.db.insert('editorEntitlements', fields);
}

/** What scripts/railway-proof.mjs --check reads: is this staging, and does it route work to Railway. */
export const ready = internalQuery({ args: {}, returns: v.object({ processorBackend: v.string(), renderProvider: v.string(), paused: v.boolean(), fixtureProjectId: v.union(v.id('projects'), v.null()) }), handler: async ctx => {
  requireStaging();
  return { processorBackend: processorBackend(), renderProvider: process.env.RENDER_PROVIDER || '', paused: process.env.RAILWAY_WORKERS_PAUSED === 'true', fixtureProjectId: (await fixture(ctx))?._id ?? null };
} });

/** Starts the three proof jobs on the fixture project through the product's own paths: createProjectFor,
 *  commitTimeline, mcp.requestFrames (a timeline frame, run by the processor) and startRenderFor (the exports). */
export const start = internalMutation({ args: {}, returns: v.object({ projectId: v.id('projects'), snapshotId: v.id('frameSnapshots'), standardJobId: v.id('renderJobs'), ultraJobId: v.id('renderJobs') }), handler: async (ctx): Promise<{ projectId: Id<'projects'>; snapshotId: Id<'frameSnapshots'>; standardJobId: Id<'renderJobs'>; ultraJobId: Id<'renderJobs'> }> => {
  requireStaging();
  if (processorBackend() !== 'railway' || process.env.RENDER_PROVIDER !== 'railway') throw new ConvexError('Staging must route processing and exports to Railway before a promotion proof.');
  if (process.env.RAILWAY_WORKERS_PAUSED === 'true') throw new ConvexError('Staging Railway workers are paused; resume them before a promotion proof.');
  // Not Ultra yet: an Ultra owner's exports all take the Ultra lane, and the standard export must run on a standard slot.
  await setPlan(ctx, false);
  const projectId = (await fixture(ctx))?._id ?? await createProjectFor(ctx, SERVICE_OWNER, { title: FIXTURE_TITLE, aspectRatio: 'vertical' });
  const project = await requireProject(ctx, projectId, SERVICE_OWNER);
  // Two seconds of one flat colour, different on every run, so no frame or export is answered from a cache.
  const color = `#${(Date.now() % 0xffffff).toString(16).padStart(6, '0')}`;
  await commitTimeline(ctx, project, { fps: 30, aspectRatio: 'vertical', clips: [{ id: 'proof-solid', kind: 'solid', track: 1, start: 0, duration: 2, sourceStart: 0, solidColor: { color, width: 1, height: 1, x: .5, y: .5, opacity: 1 } }] }, project.revision ?? 0);
  const snapshotId: Id<'frameSnapshots'> = await ctx.runMutation(internal.mcp.requestFrames, { ownerId: SERVICE_OWNER, projectId, times: [1] });
  const standardJobId = await startRenderFor(ctx, SERVICE_OWNER, { projectId, resolution: 1080, fps: 30, quality: 'draft' });
  await setPlan(ctx, true);
  const ultraJobId = await startRenderFor(ctx, SERVICE_OWNER, { projectId, resolution: 2160, fps: 30, quality: 'draft' });
  return { projectId, snapshotId, standardJobId, ultraJobId };
} });

const taskState = v.object({ taskId: v.union(v.id('mediaTasks'), v.null()), status: v.string(), error: v.optional(v.string()) });
/** The three jobs' media tasks and states, for the script to wait on. Only the service identity's own rows are read. */
export const status = internalQuery({ args: { snapshotId: v.id('frameSnapshots'), standardJobId: v.id('renderJobs'), ultraJobId: v.id('renderJobs') }, returns: v.object({ processor: taskState, standard: taskState, ultra: taskState }), handler: async (ctx, args) => {
  requireStaging();
  const state = async (row: { ownerId: string; taskId?: Id<'mediaTasks'> } | null) => {
    if (!row || row.ownerId !== SERVICE_OWNER) throw new ConvexError('Not a promotion proof job.');
    const task = row.taskId ? await ctx.db.get(row.taskId) : null;
    return { taskId: task?._id ?? null, status: task?.status ?? 'missing', ...(task?.error ? { error: task.error } : {}) };
  };
  return { processor: await state(await ctx.db.get(args.snapshotId)), standard: await state(await ctx.db.get(args.standardJobId)), ultra: await state(await ctx.db.get(args.ultraJobId)) };
} });
