import { ConvexError, v, type ObjectType } from 'convex/values';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireOwner, requireProject } from './lib/auth';
import { requireEditorAccess } from './lib/billing_access';
import { writeProject } from './lib/project_data';
import { currentTimeline, serializedBytes } from './lib/timeline';
import { editingWorkflowActive } from './lib/assistant_workflow';
import { TIMELINE_LOCKED } from '../lib/editor/timeline-sync';
import { timelineDuration, type Timeline } from '../lib/editor/types';
import { aspectRatio } from './schema';

export const MAX_TIMELINE_TABS = 10;
const STASHED_BYTES = 800_000;
type Tab = { id: string; name: string };

/** Projects made before tabs have one implicit tab. */
export const tabsOf = (project: Pick<Doc<'projects'>, 'timelineTabs'>): Tab[] => project.timelineTabs?.length ? project.timelineTabs : [{ id: 'main', name: 'Timeline 1' }];
export const activeTabOf = (project: Pick<Doc<'projects'>, 'timelineTabs' | 'activeTimelineId'>) => project.activeTimelineId ?? tabsOf(project)[0].id;

const tabName = (name: string) => { const trimmed = name.trim(); if (!trimmed || trimmed.length > 60) throw new ConvexError('Timeline names support 1–60 characters'); return trimmed; };
const stashedRow = (ctx: QueryCtx, projectId: Id<'projects'>, timelineId: string) => ctx.db.query('projectTimelines').withIndex('by_project_timeline', q => q.eq('projectId', projectId).eq('timelineId', timelineId)).unique();

/** A stored tab's timeline, for exports of a tab that is not open. */
export async function storedTabTimeline(ctx: QueryCtx, project: Doc<'projects'>, timelineId: string): Promise<Timeline | null> {
  if (timelineId === activeTabOf(project)) return currentTimeline(project);
  return (await stashedRow(ctx, project._id, timelineId))?.timeline ?? null;
}

/** Every tab's timeline, for checks that must see media used anywhere in the project. */
export async function allTabTimelines(ctx: QueryCtx, project: Doc<'projects'>): Promise<Timeline[]> {
  const rows = await ctx.db.query('projectTimelines').withIndex('by_project_timeline', q => q.eq('projectId', project._id)).take(MAX_TIMELINE_TABS);
  return [...project.timeline ? [project.timeline] : [], ...rows.map(row => row.timeline)];
}

async function openProject(ctx: MutationCtx, projectId: Id<'projects'>, ownerId: string) {
  const project = await requireProject(ctx, projectId, ownerId, true);
  await requireEditorAccess(ctx, project.ownerId);
  if (await editingWorkflowActive(ctx, project)) throw new ConvexError(TIMELINE_LOCKED);
  return project;
}

/** Store the open tab with as much undo history as fits one document. */
async function stashActive(ctx: MutationCtx, project: Doc<'projects'>) {
  const timeline = currentTimeline(project), timelineId = activeTabOf(project);
  const history = [...project.history ?? []];
  while (history.length && serializedBytes({ timeline, history }) > STASHED_BYTES) history.shift();
  const existing = await stashedRow(ctx, project._id, timelineId);
  const row = { projectId: project._id, ownerId: project.ownerId, timelineId, timeline, history };
  if (existing) await ctx.db.replace(existing._id, row); else await ctx.db.insert('projectTimelines', row);
}

/** Open a tab: its timeline becomes the project's, minus clips whose media was deleted meanwhile. */
async function openTab(ctx: MutationCtx, project: Doc<'projects'>, tabs: Tab[], timelineId: string, timeline: Timeline, history: Timeline[]) {
  const assets = new Set((await ctx.db.query('assets').withIndex('by_ownerId_projectId', q => q.eq('ownerId', project.ownerId).eq('projectId', project._id)).take(400)).map(asset => String(asset._id)));
  const present = (item: Timeline) => ({ ...item, clips: item.clips.filter(clip => !clip.assetId || assets.has(clip.assetId)) });
  const opened = present(timeline);
  await writeProject(ctx, project._id, { timeline: opened, aspectRatio: opened.aspectRatio, history: history.map(present), revision: (project.revision ?? 0) + 1, timelineTabs: tabs, activeTimelineId: timelineId, updatedAt: Date.now() });
}

export const tabSummary = v.object({ id: v.string(), name: v.string(), aspectRatio, duration: v.number(), clipCount: v.number(), active: v.boolean() });
export const list = query({ args: { projectId: v.id('projects') }, returns: v.array(tabSummary), handler: async (ctx, args) => listTabsFor(ctx, await requireOwner(ctx), args.projectId) });
export async function listTabsFor(ctx: QueryCtx, ownerId: string, projectId: Id<'projects'>) {
  const project = await requireProject(ctx, projectId, ownerId, false);
  const active = activeTabOf(project);
  const rows = new Map((await ctx.db.query('projectTimelines').withIndex('by_project_timeline', q => q.eq('projectId', project._id)).take(MAX_TIMELINE_TABS)).map(row => [row.timelineId, row.timeline]));
  return tabsOf(project).map(tab => {
    const timeline = tab.id === active ? currentTimeline(project) : rows.get(tab.id) ?? { clips: [], fps: 30, aspectRatio: project.aspectRatio };
    return { ...tab, aspectRatio: timeline.aspectRatio, duration: timelineDuration(timeline), clipCount: timeline.clips.length, active: tab.id === active };
  });
}

const createArgs = { projectId: v.id('projects'), name: v.optional(v.string()), from: v.union(v.literal('blank'), v.literal('duplicate')), aspectRatio: v.optional(aspectRatio) };
export const create = mutation({ args: createArgs, returns: v.string(), handler: async (ctx, args) => createTabFor(ctx, await requireOwner(ctx), args) });
export async function createTabFor(ctx: MutationCtx, ownerId: string, args: ObjectType<typeof createArgs>) {
  const project = await openProject(ctx, args.projectId, ownerId), tabs = tabsOf(project);
  if (tabs.length >= MAX_TIMELINE_TABS) throw new ConvexError(`A project holds up to ${MAX_TIMELINE_TABS} timelines`);
  const current = currentTimeline(project), id = crypto.randomUUID();
  const active = tabs.find(tab => tab.id === activeTabOf(project));
  const names = new Set(tabs.map(tab => tab.name));
  let name = args.name !== undefined ? tabName(args.name) : args.from === 'duplicate' && active ? `${active.name} copy` : `Timeline ${tabs.length + 1}`;
  for (let n = 2; names.has(name); n++) name = `${args.name?.trim() || (args.from === 'duplicate' && active ? `${active.name} copy` : 'Timeline')} ${n}`;
  const timeline: Timeline = args.from === 'duplicate' ? { ...current, ...(args.aspectRatio ? { aspectRatio: args.aspectRatio } : {}) } : { clips: [], fps: current.fps, aspectRatio: args.aspectRatio ?? current.aspectRatio };
  await stashActive(ctx, project);
  await openTab(ctx, project, [...tabs, { id, name }], id, timeline, []);
  return id;
}

export const open = mutation({ args: { projectId: v.id('projects'), timelineId: v.string() }, returns: v.null(), handler: async (ctx, args) => openTabFor(ctx, await requireOwner(ctx), args) });
export async function openTabFor(ctx: MutationCtx, ownerId: string, args: { projectId: Id<'projects'>; timelineId: string }) {
  const project = await openProject(ctx, args.projectId, ownerId), tabs = tabsOf(project);
  if (args.timelineId === activeTabOf(project)) return null;
  const row = tabs.some(tab => tab.id === args.timelineId) ? await stashedRow(ctx, project._id, args.timelineId) : null;
  if (!row) throw new ConvexError('That timeline no longer exists');
  await stashActive(ctx, project);
  await openTab(ctx, project, tabs, args.timelineId, row.timeline, row.history ?? []);
  await ctx.db.delete(row._id);
  return null;
}

export const rename = mutation({ args: { projectId: v.id('projects'), timelineId: v.string(), name: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  const project = await requireProject(ctx, args.projectId, await requireOwner(ctx), false);
  await requireEditorAccess(ctx, project.ownerId);
  const tabs = tabsOf(project);
  if (!tabs.some(tab => tab.id === args.timelineId)) throw new ConvexError('That timeline no longer exists');
  await writeProject(ctx, project._id, { timelineTabs: tabs.map(tab => tab.id === args.timelineId ? { ...tab, name: tabName(args.name) } : tab), activeTimelineId: activeTabOf(project), updatedAt: Date.now() });
  return null;
}});

export const remove = mutation({ args: { projectId: v.id('projects'), timelineId: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  const project = await openProject(ctx, args.projectId, await requireOwner(ctx)), tabs = tabsOf(project);
  const index = tabs.findIndex(tab => tab.id === args.timelineId);
  if (index < 0) throw new ConvexError('That timeline no longer exists');
  if (tabs.length <= 1) throw new ConvexError('A project keeps at least one timeline');
  const rest = tabs.filter(tab => tab.id !== args.timelineId);
  if (args.timelineId !== activeTabOf(project)) {
    const row = await stashedRow(ctx, project._id, args.timelineId);
    if (row) await ctx.db.delete(row._id);
    await writeProject(ctx, project._id, { timelineTabs: rest, activeTimelineId: activeTabOf(project), updatedAt: Date.now() });
    return null;
  }
  // Deleting the open tab opens its neighbour.
  const next = rest[Math.min(index, rest.length - 1)], row = await stashedRow(ctx, project._id, next.id);
  await openTab(ctx, project, rest, next.id, row?.timeline ?? { clips: [], fps: currentTimeline(project).fps, aspectRatio: project.aspectRatio }, row?.history ?? []);
  if (row) await ctx.db.delete(row._id);
  return null;
}});
