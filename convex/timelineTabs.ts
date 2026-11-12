import { ConvexError, v, type ObjectType } from 'convex/values';
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { requireOwner, requireProject } from './lib/auth';
import { requireEditorAccess } from './lib/billing_access';
import { projectIdentity, writeProject } from './lib/project_data';
import { currentTimeline } from './lib/timeline';
import { serializedBytes } from './lib/timeline_history';
import { editingWorkflowActive } from './lib/assistant_workflow';
import { TIMELINE_LOCKED } from '../lib/editor/timeline-sync';
import { timelineDuration, type Timeline } from '../lib/editor/types';
import { aspectRatio, timelineValidator } from './schema';

/** Tabs per project. A clipping job builds one tab per clip from one source, and a long stream yields dozens
 * (a 48-clip job hit the old limit of 10, issue #355). The count is bounded because several functions read
 * every stored tab at once (the editor's tab snapshots, media-in-use checks, finishClipping), and the total
 * size is bounded separately by MAX_STORED_TAB_BYTES. */
export const MAX_TIMELINE_TABS = 50;
/** The most timeline JSON a project's tabs may hold together. Each tab is capped at TIMELINE_BYTE_LIMIT
 * (300 KB), so 50 full tabs would be 15 MB: close to what one Convex function may read (16 MiB) once the
 * project document is added. 6 MB is 20 full tabs, or far more clip tabs (a clip tab is a few KB to tens of KB);
 * before this limit a project held at most 10 tabs, 3 MB, so no existing project is over it. */
export const MAX_STORED_TAB_BYTES = 6_000_000;
const STASHED_BYTES = 800_000;
/** A stored tab carries its own summary, so listing tabs never reads the (large) stored timelines. */
type Tab = { id: string; name: string; aspectRatio?: Timeline['aspectRatio']; duration?: number; clipCount?: number; bytes?: number };
const summaryOf = (timeline: Timeline) => ({ aspectRatio: timeline.aspectRatio, duration: timelineDuration(timeline), clipCount: timeline.clips.length });
/** What a stored tab records: its summary plus its size, which the tab budget adds up without reading timelines. */
const storedSummaryOf = (timeline: Timeline) => ({ ...summaryOf(timeline), bytes: serializedBytes(timeline) });
const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
/** Refuse a new tab with the limit it meets and what to do instead. Stored tabs carry their size; one stored before
 * sizes were recorded (a project of at most 10 tabs then) is measured from its row. */
async function requireTabRoom(ctx: QueryCtx, project: Doc<'projects'>, tabs: Tab[], active: Timeline, added: Timeline) {
  if (tabs.length >= MAX_TIMELINE_TABS) throw new ConvexError(`This project already has ${tabs.length} timelines, the most one project holds (${MAX_TIMELINE_TABS}). Delete a timeline that is no longer needed, or put further clips in another project (copy the footage there with its media).`);
  const activeId = activeTabOf(project);
  const sizes = await Promise.all(tabs.map(async tab => tab.id === activeId ? serializedBytes(active) : tab.bytes ?? serializedBytes((await stashedRow(ctx, project._id, tab.id))?.timeline ?? null)));
  const held = sizes.reduce((sum, bytes) => sum + bytes, 0);
  if (held + serializedBytes(added) > MAX_STORED_TAB_BYTES) throw new ConvexError(`This project's ${tabs.length} timelines hold ${megabytes(held)} of the ${megabytes(MAX_STORED_TAB_BYTES)} one project stores, so a new timeline does not fit. Delete or shorten a timeline (long captioned timelines are the largest), or put further clips in another project.`);
}
const withSummary = (tabs: Tab[], id: string, timeline: Timeline) => tabs.map(tab => tab.id === id ? { ...tab, ...storedSummaryOf(timeline) } : tab);

/** Projects made before tabs have one implicit tab. */
export const tabsOf = (project: Pick<Doc<'projects'>, 'timelineTabs'>): Tab[] => project.timelineTabs?.length ? project.timelineTabs : [{ id: 'main', name: 'Timeline 1' }];
export const activeTabOf = (project: Pick<Doc<'projects'>, 'timelineTabs' | 'activeTimelineId'>) => project.activeTimelineId ?? tabsOf(project)[0].id;

const tabName = (name: string) => { const trimmed = name.trim(); if (!trimmed || trimmed.length > 60) throw new ConvexError('Timeline names support 1–60 characters'); return trimmed; };
const stashedRow = (ctx: QueryCtx, projectId: Id<'projects'>, timelineId: string) => ctx.db.query('projectTimelines').withIndex('by_project_timeline', q => q.eq('projectId', projectId).eq('timelineId', timelineId)).unique();
const historyRow = (ctx: QueryCtx, projectId: Id<'projects'>, timelineId: string) => ctx.db.query('projectTimelineHistories').withIndex('by_project_timeline', q => q.eq('projectId', projectId).eq('timelineId', timelineId)).unique();

/** Remove a stored tab and return its undo history (rows stashed before the split keep it inline). */
async function takeStashed(ctx: MutationCtx, row: Doc<'projectTimelines'>) {
  const stored = await historyRow(ctx, row.projectId, row.timelineId);
  if (stored) await ctx.db.delete(stored._id);
  await ctx.db.delete(row._id);
  return stored?.history ?? row.history ?? [];
}

/** A stored tab's timeline, for exports of a tab that is not open. */
export async function storedTabTimeline(ctx: QueryCtx, project: Doc<'projects'>, timelineId: string): Promise<Timeline | null> {
  const timeline = timelineId === activeTabOf(project) ? currentTimeline(project) : (await stashedRow(ctx, project._id, timelineId))?.timeline;
  return timeline ? timeline : null;
}

/** Every tab's timeline, for checks that must see media used anywhere in the project. */
export async function allTabTimelines(ctx: QueryCtx, project: Doc<'projects'>): Promise<Timeline[]> {
  const rows = await ctx.db.query('projectTimelines').withIndex('by_project_timeline', q => q.eq('projectId', project._id)).take(MAX_TIMELINE_TABS);
  return [...project.timeline ? [project.timeline] : [], ...rows.map(row => row.timeline)];
}

async function openProject(ctx: MutationCtx, projectId: Id<'projects'>, ownerId: string, runId?: string) {
  const project = await requireProject(ctx, projectId, ownerId, true);
  await requireEditorAccess(ctx, project.ownerId);
  if (runId !== undefined) {
    if (!project.aiRunning || project.aiRunId !== runId) throw new ConvexError('AI run is no longer active');
    return project;
  }
  // A run works on the tab it was sent from, so no tab opens under it until it ends, even before it edits.
  if (await editingWorkflowActive(ctx, project)) throw new ConvexError(TIMELINE_LOCKED);
  return project;
}

/** Store the open tab with as much undo history as fits one document. */
async function stashActive(ctx: MutationCtx, project: Doc<'projects'>) {
  const timeline = (currentTimeline(project)), timelineId = activeTabOf(project);
  const history = [...project.history ?? []];
  while (history.length && serializedBytes({ timeline, history }) > STASHED_BYTES) history.shift();
  const existing = await stashedRow(ctx, project._id, timelineId), stored = await historyRow(ctx, project._id, timelineId);
  const row = { projectId: project._id, ownerId: project.ownerId, timelineId, timeline };
  if (existing) await ctx.db.replace(existing._id, row); else await ctx.db.insert('projectTimelines', row);
  if (stored) await ctx.db.replace(stored._id, { projectId: project._id, timelineId, history }); else await ctx.db.insert('projectTimelineHistories', { projectId: project._id, timelineId, history });
  return { timelineId, timeline };
}

/** Open a tab: its timeline becomes the project's, minus clips whose media was deleted meanwhile. */
async function openTab(ctx: MutationCtx, project: Doc<'projects'>, tabs: Tab[], timelineId: string, timeline: Timeline, history: Timeline[], preserveRevision = false) {
  const assets = new Set((await ctx.db.query('assets').withIndex('by_ownerId_projectId', q => q.eq('ownerId', project.ownerId).eq('projectId', project._id)).take(400)).map(asset => String(asset._id)));
  const present = (item: Timeline) => ({ ...item, clips: item.clips.filter(clip => !clip.assetId || assets.has(clip.assetId)) });
  const opened = present(timeline);
  const restoredHistory = history;
  await writeProject(ctx, project._id, { timeline: opened, aspectRatio: opened.aspectRatio, history: restoredHistory.map(present), revision: (project.revision ?? 0) + (preserveRevision ? 0 : 1), timelineTabs: tabs, activeTimelineId: timelineId, updatedAt: Date.now() });
}

export const tabSummary = v.object({ id: v.string(), name: v.string(), aspectRatio, duration: v.number(), clipCount: v.number(), active: v.boolean() });
/** For the editor: reads the tab mirror on projectAccess, so it re-runs when tabs change, not on every edit.
 * The open tab's summary may be stale here; the editor derives it from the timeline it already holds. */
export const list = query({ args: { projectId: v.id('projects') }, returns: v.array(tabSummary), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx);
  const access = await ctx.db.query('projectAccess').withIndex('by_project', q => q.eq('projectId', args.projectId)).unique();
  if (!access?.timelineTabs) return listTabsFor(ctx, ownerId, args.projectId);
  if (access.deleting || access.ownerId !== ownerId) throw new ConvexError('Project not found');
  const tabs = tabsOf(access), active = activeTabOf(access);
  return Promise.all(tabs.map(async tab => {
    const summary = tab.duration !== undefined && tab.clipCount !== undefined && tab.aspectRatio ? { aspectRatio: tab.aspectRatio, duration: tab.duration, clipCount: tab.clipCount } : tab.id === active ? { aspectRatio: 'vertical' as const, duration: 0, clipCount: 0 } : summaryOf((await stashedRow(ctx, args.projectId, tab.id))?.timeline ?? { clips: [], fps: 30, aspectRatio: 'vertical' });
    return { id: tab.id, name: tab.name, ...summary, active: tab.id === active };
  }));
} });
/** Exact summaries, including the open tab's, for agents. */
export async function listTabsFor(ctx: QueryCtx, ownerId: string, projectId: Id<'projects'>) {
  const project = await requireProject(ctx, projectId, ownerId, false);
  const active = activeTabOf(project);
  // Stored tabs carry a summary; only tabs stashed before summaries existed read their stored timeline.
  return Promise.all(tabsOf(project).map(async tab => {
    const summary = tab.id === active ? summaryOf(currentTimeline(project)) : tab.duration !== undefined && tab.clipCount !== undefined && tab.aspectRatio ? { aspectRatio: tab.aspectRatio, duration: tab.duration, clipCount: tab.clipCount } : summaryOf((await stashedRow(ctx, project._id, tab.id))?.timeline ?? { clips: [], fps: 30, aspectRatio: project.aspectRatio });
    return { id: tab.id, name: tab.name, ...summary, active: tab.id === active };
  }));
}

const createArgs = { projectId: v.id('projects'), name: v.optional(v.string()), from: v.union(v.literal('blank'), v.literal('duplicate')), aspectRatio: v.optional(aspectRatio) };
/** The other tabs' timelines, so the editor can show one the moment it is clicked. */
export const snapshots = query({ args: { projectId: v.id('projects'), sceneCode: v.optional(v.literal('refs')) }, returns: v.array(v.object({ id: v.string(), timeline: timelineValidator })), handler: async (ctx, args) => {
  // Ownership from the small access record, not the project: this query then re-runs only when a
  // stored tab changes (on a switch), not on every edit of the open timeline.
  await projectIdentity(ctx, args.projectId, await requireOwner(ctx));
  const rows = await ctx.db.query('projectTimelines').withIndex('by_project_timeline', q => q.eq('projectId', args.projectId)).take(MAX_TIMELINE_TABS);
  return Promise.all(rows.map(async row => ({ id: row.timelineId, timeline: row.timeline })));
}});

export const create = mutation({ args: createArgs, returns: v.string(), handler: async (ctx, args) => createTabFor(ctx, await requireOwner(ctx), args) });
export async function createTabFor(ctx: MutationCtx, ownerId: string, args: ObjectType<typeof createArgs>, runId?: string) {
  const project = await openProject(ctx, args.projectId, ownerId, runId), tabs = tabsOf(project);
  const current = currentTimeline(project), id = crypto.randomUUID();
  const active = tabs.find(tab => tab.id === activeTabOf(project));
  const names = new Set(tabs.map(tab => tab.name));
  let name = args.name !== undefined ? tabName(args.name) : args.from === 'duplicate' && active ? `${active.name} copy` : `Timeline ${tabs.length + 1}`;
  for (let n = 2; names.has(name); n++) name = `${args.name?.trim() || (args.from === 'duplicate' && active ? `${active.name} copy` : 'Timeline')} ${n}`;
  const timeline: Timeline = args.from === 'duplicate' ? { ...current, ...(args.aspectRatio ? { aspectRatio: args.aspectRatio } : {}) } : { clips: [], fps: 60, aspectRatio: args.aspectRatio ?? current.aspectRatio };
  await requireTabRoom(ctx, project, tabs, current, timeline);
  const stashed = await stashActive(ctx, project);
  await openTab(ctx, project, withSummary([...tabs, { id, name }], stashed.timelineId, stashed.timeline), id, timeline, []);
  return id;
}

export const open = mutation({ args: { projectId: v.id('projects'), timelineId: v.string() }, returns: v.null(), handler: async (ctx, args) => openTabFor(ctx, await requireOwner(ctx), args) });
export async function openTabFor(ctx: MutationCtx, ownerId: string, args: { projectId: Id<'projects'>; timelineId: string }, runId?: string, preserveRevision = false) {
  const project = await openProject(ctx, args.projectId, ownerId, runId), tabs = tabsOf(project);
  if (args.timelineId === activeTabOf(project)) return null;
  const row = tabs.some(tab => tab.id === args.timelineId) ? await stashedRow(ctx, project._id, args.timelineId) : null;
  if (!row) throw new ConvexError('That timeline no longer exists');
  const stashed = await stashActive(ctx, project);
  await openTab(ctx, project, withSummary(tabs, stashed.timelineId, stashed.timeline), args.timelineId, row.timeline, await takeStashed(ctx, row), preserveRevision);
  return null;
}

export const rename = mutation({ args: { projectId: v.id('projects'), timelineId: v.string(), name: v.string() }, returns: v.null(), handler: async (ctx, args) => renameTabFor(ctx, await requireOwner(ctx), args) });
export async function renameTabFor(ctx: MutationCtx, ownerId: string, args: { projectId: Id<'projects'>; timelineId: string; name: string }) {
  const project = await requireProject(ctx, args.projectId, ownerId, false);
  await requireEditorAccess(ctx, project.ownerId);
  const tabs = tabsOf(project);
  if (!tabs.some(tab => tab.id === args.timelineId)) throw new ConvexError('That timeline no longer exists');
  await writeProject(ctx, project._id, { timelineTabs: tabs.map(tab => tab.id === args.timelineId ? { ...tab, name: tabName(args.name) } : tab), activeTimelineId: activeTabOf(project), updatedAt: Date.now() });
  return null;
}

export const remove = mutation({ args: { projectId: v.id('projects'), timelineId: v.string() }, returns: v.null(), handler: async (ctx, args) => removeTabFor(ctx, await requireOwner(ctx), args) });
export async function removeTabFor(ctx: MutationCtx, ownerId: string, args: { projectId: Id<'projects'>; timelineId: string },runId?:string) {
  const project = await openProject(ctx, args.projectId, ownerId,runId), tabs = tabsOf(project);
  const index = tabs.findIndex(tab => tab.id === args.timelineId);
  if (index < 0) throw new ConvexError('That timeline no longer exists');
  if (tabs.length <= 1) throw new ConvexError('A project keeps at least one timeline');
  const rest = tabs.filter(tab => tab.id !== args.timelineId);
  if (args.timelineId !== activeTabOf(project)) {
    const row = await stashedRow(ctx, project._id, args.timelineId);
    if (row) await takeStashed(ctx, row);
    await writeProject(ctx, project._id, { timelineTabs: rest, activeTimelineId: activeTabOf(project), updatedAt: Date.now() });
    return null;
  }
  // Deleting the open tab opens its neighbour.
  const next = rest[Math.min(index, rest.length - 1)], row = await stashedRow(ctx, project._id, next.id);
  await openTab(ctx, project, rest, next.id, row?.timeline ?? { clips: [], fps: currentTimeline(project).fps, aspectRatio: project.aspectRatio }, row ? await takeStashed(ctx, row) : []);
  return null;
}

/** One-time backfill: give tabs stashed before summaries existed their summary, so listing tabs
 * stops reading their stored timelines. Runs a page of projects at a time and schedules the next. */
export const backfillTabSummaries = internalMutation({ args: { cursor: v.optional(v.union(v.string(), v.null())) }, returns: v.null(), handler: async (ctx, args) => {
  const page = await ctx.db.query('projects').paginate({ cursor: args.cursor ?? null, numItems: 5 });
  for (const project of page.page) {
    if (!project.timelineTabs?.length || project.deleting) continue;
    const active = activeTabOf(project);
    if (project.timelineTabs.every(tab => tab.id === active || tab.duration !== undefined)) continue;
    const tabs = await Promise.all(project.timelineTabs.map(async tab => {
      if (tab.id === active || tab.duration !== undefined) return tab;
      const row = await stashedRow(ctx, project._id, tab.id);
      return row ? { ...tab, ...storedSummaryOf(row.timeline) } : tab;
    }));
    await writeProject(ctx,project._id, { timelineTabs: tabs });
  }
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.timelineTabs.backfillTabSummaries, { cursor: page.continueCursor });
  return null;
} });

/** Admin export (CLI only): a project's tabs with their full timelines and the media they use, for
 * copying an edit between deployments. */
export const exportTabs = internalQuery({ args: { projectId: v.id('projects') }, returns: v.any(), handler: async (ctx, { projectId }) => {
  const project = await ctx.db.get(projectId);
  if (!project) throw new ConvexError('Project not found');
  const active = activeTabOf(project);
  const tabs = await Promise.all(tabsOf(project).map(async tab => ({ name: tab.name, active: tab.id === active, timeline: await storedTabTimeline(ctx, project, tab.id) })));
  const ids = new Set(tabs.flatMap(tab => tab.timeline?.clips.flatMap(clip => clip.assetId ? [clip.assetId] : []) ?? []));
  const assets = (await Promise.all([...ids].map(async id => { const asset = await ctx.db.get(id as Id<'assets'>); return asset ? { _id: asset._id, kind: asset.kind, fileName: asset.fileName, r2Key: asset.r2Key ?? null } : null; }))).filter(Boolean);
  return { tabs, assets };
} });

/** Admin import (CLI only): add a tab to a project from an exported timeline, mapping every media ID
 * through `assetMap`. Every mapped asset must belong to the target project. The open tab is untouched. */
export const importTab = internalMutation({ args: { projectId: v.id('projects'), name: v.string(), timeline: timelineValidator, assetMap: v.record(v.string(), v.id('assets')) }, returns: v.string(), handler: async (ctx, args) => {
  const project = await ctx.db.get(args.projectId);
  if (!project) throw new ConvexError('Project not found');
  const tabs = tabsOf(project);
  await requireTabRoom(ctx, project, tabs, currentTimeline(project), args.timeline);
  for (const id of new Set(Object.values(args.assetMap))) {
    const asset = await ctx.db.get(id);
    if (!asset || asset.projectId !== project._id || asset.ownerId !== project.ownerId) throw new ConvexError(`Media ${id} is not in the target project`);
  }
  const missing = args.timeline.clips.filter(clip => clip.assetId && !args.assetMap[clip.assetId]);
  if (missing.length) throw new ConvexError(`No mapping for media ${[...new Set(missing.map(clip => clip.assetId))].join(', ')}`);
  const timeline = { ...args.timeline, clips: args.timeline.clips.map(clip => clip.assetId ? { ...clip, assetId: args.assetMap[clip.assetId] } : clip) };
  const timelineId = crypto.randomUUID(), name = tabName(args.name);
  await ctx.db.insert('projectTimelines', { projectId: project._id, ownerId: project.ownerId, timelineId, timeline: timeline });
  await writeProject(ctx, project._id, { timelineTabs: [...tabs, { id: timelineId, name, ...storedSummaryOf(timeline) }], activeTimelineId: activeTabOf(project), updatedAt: Date.now() });
  return timelineId;
} });

/** One-time move of inline tab history into projectTimelineHistories, so tab rows stay timeline-sized. */
export const splitStashedHistory = internalMutation({ args: { cursor: v.union(v.string(), v.null()) }, returns: v.object({ moved: v.number(), done: v.boolean() }), handler: async (ctx, { cursor }) => {
  const page = await ctx.db.query('projectTimelines').paginate({ cursor, numItems: 5 });
  let moved = 0;
  for (const row of page.page) {
    if (row.history === undefined) continue;
    if (!await historyRow(ctx, row.projectId, row.timelineId)) await ctx.db.insert('projectTimelineHistories', { projectId: row.projectId, timelineId: row.timelineId, history: row.history });
    const { _id, _creationTime, history: _, ...rest } = row;
    await ctx.db.replace(_id, rest); moved++;
  }
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.timelineTabs.splitStashedHistory, { cursor: page.continueCursor });
  return { moved, done: page.isDone };
} });
