import { tableRow } from './lib/exact';
import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type MutationCtx } from './_generated/server';
import { requireOwner, requireProject } from './lib/auth';
import { exportPlan, type ExportSettings } from './postExports';
import { startRenderFor } from './renders';
import { activeTabOf, storedTabTimeline, tabsOf } from './timelineTabs';
import { MAX_EXPORT_SECONDS } from '../lib/editor/limits';
import { timelineDuration } from '../lib/editor/types';

// Export for the in-app assistant. Its exportVideo call only stores a proposal, shown as a card in the chat with the
// timeline and the exact settings; nothing renders until the signed-in user presses Export on the card. The settings
// are the user's existing ones (postExports.exportPlan); a setting the user asked for in chat is shown on the card,
// marked, and applies to that one export only. Over MCP, exportVideo keeps rendering directly once the task confirmed it.

const PROPOSAL_MS = 15 * 60_000;
const SETTING_NAMES: Record<keyof ExportSettings, string> = { resolution: 'resolution', fps: 'frame rate', quality: 'quality' };

/** Checks the request and stores the card. Returns what the tool tells the assistant. Shared by the run mutation. */
export async function proposeExportFor(ctx: MutationCtx, ownerId: string, args: { projectId: Id<'projects'>; timelineId?: string } & Partial<ExportSettings>) {
  const project = await requireProject(ctx, args.projectId, ownerId), timelineId = args.timelineId ?? activeTabOf(project);
  const tab = tabsOf(project).find(item => item.id === timelineId);
  const timeline = tab ? await storedTabTimeline(ctx, project, timelineId) : null;
  if (!tab || !timeline) throw new ConvexError('That timeline no longer exists. listTimelines shows the tabs.');
  if (!timeline.clips.length) throw new ConvexError('This timeline is empty, so there is nothing to export.');
  const duration = timelineDuration(timeline);
  if (duration > MAX_EXPORT_SECONDS) throw new ConvexError('Exports currently support up to five minutes. Shorten the edit before exporting.');
  const requested = Object.fromEntries((['resolution', 'fps', 'quality'] as const).flatMap(key => args[key] === undefined ? [] : [[key, args[key]]])) as Partial<ExportSettings>;
  const plan = await exportPlan(ctx, ownerId, project, timelineId, requested);
  if (plan.settings.resolution === 2160 && !plan.ultra) throw new ConvexError('4K export is part of the Ultra plan. Nothing was exported.');
  const changed = (Object.keys(requested) as (keyof ExportSettings)[]).filter(key => requested[key] !== plan.existing[key]);
  // An unchanged timeline is never rendered twice: a finished or running export with these settings is reused.
  const reuse = plan.ready ?? plan.running, now = Date.now();
  const proposalId = await ctx.db.insert('exportProposals', tableRow<'exportProposals'>()({
    ownerId, projectId: project._id, timelineId, timelineName: tab.name, duration, aspectRatio: timeline.aspectRatio, ...plan.settings, changed, createdAt: now, expiresAt: now + PROPOSAL_MS,
    ...(reuse ? { status: 'confirmed' as const, jobId: reuse._id } : { status: 'proposed' as const }),
  }));
  const settings = { ...plan.settings, ...(changed.length ? { changedForThisExport: changed.map(key => SETTING_NAMES[key]) } : {}) };
  if (reuse) return {
    awaitingConfirmation: false, proposalId, ...(plan.ready ? { alreadyExported: true } : { alreadyExporting: true }), jobId: reuse._id, timeline: tab.name, duration, settings,
    next: plan.ready
      ? 'This timeline is unchanged since its last export with these settings, so nothing was exported again. The card in the chat has its Download button. Tell the user in one short sentence.'
      : 'An export of this exact version is already running; the card in the chat follows it. Tell the user in one short sentence; do not export again.',
  };
  return {
    awaitingConfirmation: true, proposalId, timeline: tab.name, duration, settings,
    next: 'Nothing has been exported. A card with the timeline and these settings is now in the chat; only the user pressing Export on it starts the render, and it then shows progress and the download. Your turn ends with the card. Never say it is exporting or exported.',
  };
}

const proposalState = (row: Doc<'exportProposals'>, now: number) => row.status === 'proposed' && row.expiresAt <= now ? 'expired' as const : row.status;
async function ownedProposal(ctx: MutationCtx, proposalId: Id<'exportProposals'>) {
  const ownerId = await requireOwner(ctx), row = await ctx.db.get(proposalId);
  if (!row || row.ownerId !== ownerId) throw new ConvexError('Export not found');
  return { ownerId, row };
}

/** The card: the timeline, the settings and which of them the user changed in chat, and the export once it was started. */
export const proposal = query({
  args: { proposalId: v.id('exportProposals') }, returns: v.any(),
  handler: async (ctx, { proposalId }) => {
    // Another account's card, or one cleaned up, shows nothing instead of failing the chat.
    const ownerId = await requireOwner(ctx), row = await ctx.db.get(proposalId);
    if (!row || row.ownerId !== ownerId) return null;
    const job = row.jobId ? await ctx.db.get(row.jobId) : null;
    return {
      status: proposalState(row, Date.now()), expiresAt: row.expiresAt,
      timeline: row.timelineName, duration: row.duration, aspectRatio: row.aspectRatio,
      settings: { resolution: row.resolution, fps: row.fps, quality: row.quality }, changed: row.changed,
      job: job && job.ownerId === ownerId ? { jobId: job._id, status: job.status, progress: job.progress ?? 0, error: job.error ?? null, ready: job.status === 'completed' && !!(job.outputR2Key || job.outputStorageId) } : null,
    };
  },
});

/** The user's press of Export: the only way an assistant export starts in the editor. */
export const confirmProposal = mutation({
  args: { proposalId: v.id('exportProposals') }, returns: v.id('renderJobs'),
  handler: async (ctx, { proposalId }) => {
    const { ownerId, row } = await ownedProposal(ctx, proposalId), state = proposalState(row, Date.now());
    if (state === 'confirmed' && row.jobId) return row.jobId;
    if (state !== 'proposed') throw new ConvexError(state === 'cancelled' ? 'This export was cancelled. Ask the assistant again to export it.' : 'This confirmation expired. Ask the assistant again to export it.');
    const project = await requireProject(ctx, row.projectId, ownerId), settings = { resolution: row.resolution, fps: row.fps, quality: row.quality };
    if (!tabsOf(project).some(tab => tab.id === row.timelineId)) throw new ConvexError('That timeline no longer exists.');
    // A second card or editor tab for the same version follows the export already made instead of rendering it again.
    const plan = await exportPlan(ctx, ownerId, project, row.timelineId, settings);
    const jobId = plan.ready?._id ?? plan.running?._id ?? await startRenderFor(ctx, ownerId, { projectId: project._id, ...settings, ...(row.timelineId !== activeTabOf(project) ? { timelineId: row.timelineId } : {}) });
    // A setting changed in chat is for this export only: the next export still starts from the user's own settings.
    if (row.changed.length && !plan.ready && !plan.running) await ctx.db.patch(jobId, { settingsOverride: true });
    await ctx.db.patch(proposalId, { status: 'confirmed', jobId });
    return jobId;
  },
});

export const cancelProposal = mutation({
  args: { proposalId: v.id('exportProposals') }, returns: v.null(),
  handler: async (ctx, { proposalId }) => {
    const { row } = await ownedProposal(ctx, proposalId);
    if (row.status === 'proposed') await ctx.db.patch(proposalId, { status: 'cancelled' });
    return null;
  },
});
