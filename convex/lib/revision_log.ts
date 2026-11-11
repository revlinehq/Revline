import { tableRow } from './exact';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Clip, Timeline } from '../../lib/editor/types';
import { equalTimelineValue } from '../../lib/editor/timeline-equality';
import { runAuthorLabel } from './run_ids';

/** Revisions kept per project. Each row is small (scene code is stored by hash), so this covers weeks of editing. */
const REVISION_RETENTION = 2000;
/** The row that holds a tab's settings besides its clips (fps, aspect ratio, tracks, markers, LUTs). */
export const TIMELINE_ROW = ':timeline';
/** restoreTimeline reads every change since the revision; past this many it asks for single clips instead. */
const TIMELINE_RESTORE_ROWS = 4000;

export type RevisionNote = { tool?: string };
type Change = { clipId: string; before: Clip | null; index?: number; rest?: Timeline };

const restOf = (timeline: Timeline): Timeline => ({ ...timeline, clips: [] });
// Stored documents come back with their keys reordered, so compare by value.
const same = equalTimelineValue;

function clipLabel(clip: Clip) {
  const name = clip.scene?.title ?? (clip.text ? clip.text.replace(/\s+/g, ' ').slice(0, 40) : undefined);
  return `${clip.kind}${name ? ` "${name}"` : ''} (${clip.id.slice(0, 8)})`;
}
/** Top-level settings an edit changed, with a scene's code and parts named. */
function changedFields(before: Clip, after: Clip) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)].filter(key => key !== 'id'));
  const fields: string[] = [];
  for (const key of keys) {
    const a = before[key as keyof Clip], b = after[key as keyof Clip];
    if (same(a, b)) continue;
    if (key === 'scene' && a && b && typeof a === 'object' && typeof b === 'object') {
      for (const part of new Set([...Object.keys(a), ...Object.keys(b)])) if (!same((a as Record<string, unknown>)[part], (b as Record<string, unknown>)[part])) fields.push(part === 'code' || part === 'codeRef' ? 'scene code' : `scene ${part}`);
    } else fields.push(key);
  }
  return [...new Set(fields)];
}

function describe(changes: Change[], next: Timeline) {
  const after = new Map(next.clips.map(clip => [clip.id, clip]));
  const parts: string[] = [];
  const added = changes.filter(change => change.clipId !== TIMELINE_ROW && !change.before).map(change => after.get(change.clipId)!);
  const removed = changes.filter(change => change.before && !after.has(change.clipId)).map(change => change.before!);
  const edited = changes.filter(change => change.before && after.has(change.clipId));
  for (const change of edited.slice(0, 4)) parts.push(`edited ${clipLabel(change.before!)}: ${changedFields(change.before!, after.get(change.clipId)!).slice(0, 6).join(', ')}`);
  if (edited.length > 4) parts.push(`edited ${edited.length - 4} more clips`);
  if (added.length) parts.push(added.length > 3 ? `added ${added.length} clips` : `added ${added.map(clipLabel).join(', ')}`);
  if (removed.length) parts.push(removed.length > 3 ? `removed ${removed.length} clips` : `removed ${removed.map(clipLabel).join(', ')}`);
  if (changes.some(change => change.clipId === TIMELINE_ROW)) parts.push('changed timeline settings');
  const text = parts.join('; ');
  return (text.charAt(0).toUpperCase() + text.slice(1)).slice(0, 400);
}

/** Record one saved edit of a tab, comparing stored (scene-code-by-hash) timelines. Called from writeProject. */
export async function recordRevision(ctx: MutationCtx, project: Doc<'projects'>, timelineId: string, previous: Timeline, next: Timeline, revision: number, note?: RevisionNote) {
  const before = new Map(previous.clips.map((clip, index) => [clip.id, { clip, index }]));
  const changes: Change[] = [];
  for (const clip of next.clips) {
    const old = before.get(clip.id);
    if (!old) changes.push({ clipId: clip.id, before: null });
    else if (!same(old.clip, clip)) changes.push({ clipId: clip.id, before: old.clip, index: old.index });
  }
  const remaining = new Set(next.clips.map(clip => clip.id));
  for (const [clipId, old] of before) if (!remaining.has(clipId)) changes.push({ clipId, before: old.clip, index: old.index });
  if (!same(restOf(previous), restOf(next))) changes.push({ clipId: TIMELINE_ROW, before: null, rest: restOf(previous) });
  if (!changes.length) return;
  const by = project.aiRunning ? runAuthorLabel(project.aiRunId, project.aiAgentName) : 'Editor';
  await ctx.db.insert('revisionLog', { projectId: project._id, timelineId, revision, at: Date.now(), by, ...(note?.tool ? { tool: note.tool.slice(0, 120) } : {}), summary: describe(changes, next), clipIds: changes.map(change => change.clipId).filter(id => id !== TIMELINE_ROW) });
  for (const change of changes) await ctx.db.insert('revisionClips', tableRow<'revisionClips'>()({ projectId: project._id, timelineId, revision, ...change }));
  // Drop the oldest revisions past retention, a few per edit.
  const old = await ctx.db.query('revisionLog').withIndex('by_project_revision', q => q.eq('projectId', project._id).lte('revision', revision - REVISION_RETENTION)).take(3);
  for (const row of old) await removeRevision(ctx, project._id, row);
}

async function removeRevision(ctx: MutationCtx, projectId: Id<'projects'>, row: Doc<'revisionLog'>) {
  const clips = await ctx.db.query('revisionClips').withIndex('by_project_revision', q => q.eq('projectId', projectId).eq('revision', row.revision)).collect();
  for (const clip of clips) await ctx.db.delete(clip._id);
  await ctx.db.delete(row._id);
}

/** For project deletion: removes a batch, true while rows remain. */
export async function deleteRevisionBatch(ctx: MutationCtx, projectId: Id<'projects'>) {
  const clips = await ctx.db.query('revisionClips').withIndex('by_project_revision', q => q.eq('projectId', projectId)).take(500);
  for (const row of clips) await ctx.db.delete(row._id);
  const logs = await ctx.db.query('revisionLog').withIndex('by_project_revision', q => q.eq('projectId', projectId)).take(500);
  for (const row of logs) await ctx.db.delete(row._id);
  return clips.length + logs.length > 0;
}

/** The earliest revision any tab can be put back to: history covers every change after it. */
export async function historyStart(ctx: QueryCtx, projectId: Id<'projects'>, currentRevision: number) {
  const oldest = await ctx.db.query('revisionLog').withIndex('by_project_revision', q => q.eq('projectId', projectId)).first();
  return oldest ? oldest.revision - 1 : currentRevision;
}

export async function listRevisions(ctx: QueryCtx, projectId: Id<'projects'>, options: { timelineId?: string; clipId?: string; revision?: number; limit: number }) {
  if (options.revision !== undefined) {
    const rows = await ctx.db.query('revisionLog').withIndex('by_project_revision', q => q.eq('projectId', projectId).eq('revision', options.revision!)).collect();
    return rows.filter(row => (!options.timelineId || row.timelineId === options.timelineId) && (!options.clipId || row.clipIds.includes(options.clipId)));
  }
  if (options.clipId) {
    const { clipId, timelineId } = options;
    const touches = await ctx.db.query('revisionClips').withIndex('by_clip', q => q.eq('projectId', projectId).eq('timelineId', timelineId!).eq('clipId', clipId)).order('desc').take(options.limit);
    const rows = await Promise.all(touches.map(touch => ctx.db.query('revisionLog').withIndex('by_project_tab_revision', q => q.eq('projectId', projectId).eq('timelineId', timelineId!).eq('revision', touch.revision)).first()));
    return rows.filter(row => !!row);
  }
  const query = options.timelineId
    ? ctx.db.query('revisionLog').withIndex('by_project_tab_revision', q => q.eq('projectId', projectId).eq('timelineId', options.timelineId!))
    : ctx.db.query('revisionLog').withIndex('by_project_revision', q => q.eq('projectId', projectId));
  return query.order('desc').take(options.limit);
}

/** Load a stored clip's scene code. */
const loadClip = async (ctx: QueryCtx, clip: Clip) => (({ clips: [clip] })).clips[0];

/** One clip's state at a revision: the `before` of its first change after it, or unchanged since (null `change`). */
export async function clipChangeAfter(ctx: QueryCtx, projectId: Id<'projects'>, timelineId: string, clipId: string, revision: number) {
  const first = await ctx.db.query('revisionClips').withIndex('by_clip', q => q.eq('projectId', projectId).eq('timelineId', timelineId).eq('clipId', clipId).gt('revision', revision)).first();
  if (!first) return null;
  const last = await ctx.db.query('revisionClips').withIndex('by_clip', q => q.eq('projectId', projectId).eq('timelineId', timelineId).eq('clipId', clipId)).order('desc').first();
  return { changedAt: first.revision, lastChangedAt: last!.revision, before: first.before && await loadClip(ctx, first.before), index: first.index };
}

/** Every clip and setting of a tab that changed after a revision, each with its state at that revision. */
export async function tabChangesAfter(ctx: QueryCtx, projectId: Id<'projects'>, timelineId: string, revision: number) {
  const rows = await ctx.db.query('revisionClips').withIndex('by_project_tab_revision', q => q.eq('projectId', projectId).eq('timelineId', timelineId).gt('revision', revision)).take(TIMELINE_RESTORE_ROWS + 1);
  if (rows.length > TIMELINE_RESTORE_ROWS) return null;
  const first = new Map<string, Doc<'revisionClips'>>();
  for (const row of rows) if (!first.has(row.clipId)) first.set(row.clipId, row);
  return Promise.all([...first.values()].map(async row => ({ clipId: row.clipId, before: row.before && await loadClip(ctx, row.before), index: row.index, rest: row.rest })));
}

/** Put one clip in a timeline: replaced where it is, or inserted near its old position. */
export function placeClip(timeline: Timeline, clip: Clip, index?: number): Timeline {
  if (timeline.clips.some(item => item.id === clip.id)) return { ...timeline, clips: timeline.clips.map(item => item.id === clip.id ? clip : item) };
  const clips = [...timeline.clips];
  clips.splice(Math.min(index ?? clips.length, clips.length), 0, clip);
  return { ...timeline, clips };
}

/** A tab as it was at a revision: its timeline now with every later change taken back, as restoreTimeline does. Null when too much changed since. */
export async function timelineAtRevision(ctx: QueryCtx, projectId: Id<'projects'>, timelineId: string, current: Timeline, revision: number) {
  const changes = await tabChangesAfter(ctx, projectId, timelineId, revision);
  if (!changes) return null;
  return [...changes].sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity)).reduce<Timeline>((next, change) => change.clipId === TIMELINE_ROW ? (change.rest ? { ...change.rest, clips: next.clips } : next) : change.before ? placeClip(next, change.before, change.index) : { ...next, clips: next.clips.filter(clip => clip.id !== change.clipId) }, current);
}
