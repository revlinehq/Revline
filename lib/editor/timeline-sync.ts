import { deriveTrackCounts, normalizeTimeline, TIMELINE_LAYER_GROUPS, type Clip, type Timeline } from './types';
import { reconcileTransitionEdits } from './clip-transitions';
import { timelineHistoryKey } from './timeline-history-key';

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => equal(value, b[index]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every(key => equal(left[key], right[key]));
}

// Apply the user's changed fields to the latest timeline, preserving unrelated
// live edits. A manual change wins on the fields it touches; deleted clips stay deleted.
export function applyTimelineEdit(base: Timeline, next: Timeline, current: Timeline): Timeline {
  base = normalizeTimeline(base); next = normalizeTimeline(next); current = normalizeTimeline(current);
  const before = new Map(base.clips.map(clip => [clip.id, clip]));
  const after = new Map(next.clips.map(clip => [clip.id, clip]));
  const clips = current.clips.flatMap(clip => {
    const old = before.get(clip.id), edited = after.get(clip.id);
    if (!old) return [clip];
    if (!edited) return [];
    const merged = { ...clip } as Clip;
    for (const key of new Set([...Object.keys(old), ...Object.keys(edited)]) as Set<keyof Clip>) {
      if (equal(old[key], edited[key])) continue;
      if (key === 'transform' && old.transform && edited.transform && clip.transform) {
        merged.transform = { ...clip.transform };
        for (const field of Object.keys(edited.transform) as (keyof NonNullable<Clip['transform']>)[]) {
          if (!equal(old.transform[field], edited.transform[field])) merged.transform[field] = edited.transform[field];
        }
      } else if (edited[key] === undefined) delete merged[key];
      else Object.assign(merged, { [key]: edited[key] });
    }
    // Source offset, speed and duration describe one retained range.
    if (old.duration !== edited.duration || old.sourceStart !== edited.sourceStart || old.playbackRate !== edited.playbackRate) {
      merged.duration = edited.duration; merged.sourceStart = edited.sourceStart;
      if (edited.playbackRate === undefined) delete merged.playbackRate;
      else merged.playbackRate = edited.playbackRate;
    }
    return [merged];
  });
  const existing = new Set(current.clips.map(clip => clip.id));
  clips.push(...next.clips.filter(clip => !before.has(clip.id) && !existing.has(clip.id)));
  const merged: Timeline = {
    ...current, clips,
    fps: base.fps === next.fps ? current.fps : next.fps,
    aspectRatio: base.aspectRatio === next.aspectRatio ? current.aspectRatio : next.aspectRatio,
  };
  if (!equal(base.markers, next.markers)) {
    const beforeMarkers = new Map((base.markers ?? []).map(marker => [marker.id, marker]));
    const afterMarkers = new Map((next.markers ?? []).map(marker => [marker.id, marker]));
    const currentIds = new Set((current.markers ?? []).map(marker => marker.id));
    merged.markers = (current.markers ?? []).flatMap(marker => {
      const old = beforeMarkers.get(marker.id), edited = afterMarkers.get(marker.id);
      if (!old) return [marker];
      if (!edited) return [];
      const updated = { ...marker, time: old.time === edited.time ? marker.time : edited.time };
      if (old.label !== edited.label) {
        if (edited.label === undefined) delete updated.label;
        else updated.label = edited.label;
      }
      return [updated];
    });
    merged.markers.push(...(next.markers ?? []).filter(marker => !beforeMarkers.has(marker.id) && !currentIds.has(marker.id)));
  }
  const baseCounts = deriveTrackCounts(base), nextCounts = deriveTrackCounts(next), counts = deriveTrackCounts(current);
  for (const group of TIMELINE_LAYER_GROUPS) {
    if (nextCounts[group] !== baseCounts[group]) counts[group] = nextCounts[group] > baseCounts[group] ? Math.max(counts[group], nextCounts[group]) : nextCounts[group];
  }
  merged.tracks = counts;
  merged.tracks = deriveTrackCounts(merged);
  return reconcileTransitionEdits(current, merged);
}

export type TimelineSnapshot = { timeline: Timeline; revision: number; history?: Timeline[] };
type PendingEdit = { baseTimeline: Timeline; timeline: Timeline; undoTo?: Timeline; undoHistoryKeys?: string[]; undoTargetKey?: string };
type QueuedEdit = Omit<PendingEdit, 'undoHistoryKeys' | 'undoTargetKey'> & { undoHistory?: Timeline[]; undoOrigin?: Timeline };
type SaveCallbacks = {
  save: (edit: PendingEdit & { expectedRevision: number }) => Promise<TimelineSnapshot>;
  load: () => Promise<TimelineSnapshot>;
  update: (timeline: Timeline, kind: 'saved' | 'remote' | 'recovered', history?: Timeline[]) => void;
  saving: (busy: boolean) => void;
  error: (error: unknown) => void;
};

// One queue per project. Keep acknowledged state separate from optimistic edits.
export function createTimelineSaveQueue(initial: TimelineSnapshot, callbacks: SaveCallbacks) {
  initial = { ...initial, timeline: normalizeTimeline(initial.timeline) };
  let saved = initial, visible = initial.timeline, remote = initial;
  let pending: QueuedEdit | null = null, recovery: QueuedEdit[] | null = null;
  let busy = false, failure: unknown = null;
  const waiters: { resolve: () => void; reject: (error: unknown) => void }[] = [];
  function adopt(snapshot: TimelineSnapshot, kind: 'saved' | 'remote' | 'recovered', edits: QueuedEdit[]) {
    snapshot = { ...snapshot, timeline: normalizeTimeline(snapshot.timeline) };
    let next = snapshot.timeline, undo: Pick<QueuedEdit, 'undoTo' | 'undoHistory' | 'undoOrigin'> = {};
    for (const edit of edits) {
      // Preserve ordered intents. A→B followed by B→A is still an undo if the
      // first request committed but its response was lost; flattening A→A loses it.
      if (edit.undoTo) undo = { undoTo: applyTimelineEdit(edit.baseTimeline, edit.undoTo, next), undoOrigin: edit.undoOrigin ?? edit.undoTo, ...(edit.undoHistory ? { undoHistory: edit.undoHistory } : {}) };
      next = applyTimelineEdit(edit.baseTimeline, edit.timeline, next);
    }
    saved = snapshot; visible = next; recovery = null;
    const historyAcknowledged = !undo.undoTo || (undo.undoHistory !== undefined && snapshot.history !== undefined && equal(undo.undoHistory.map(normalizeTimeline), snapshot.history.map(normalizeTimeline)));
    pending = equal(next, snapshot.timeline) && historyAcknowledged ? null : { baseTimeline: snapshot.timeline, timeline: next, ...undo };
    callbacks.update(visible, kind, kind === 'remote' ? snapshot.history : undefined);
  }
  function receive(snapshot: TimelineSnapshot) {
    if (snapshot.revision > remote.revision) remote = snapshot;
    if (busy || snapshot.revision <= saved.revision) return;
    const edits = [...(recovery ?? []), ...(pending ? [pending] : [])];
    adopt(snapshot, edits.length ? 'recovered' : 'remote', edits);
  }
  async function reload() {
    const loaded = await callbacks.load();
    adopt(remote.revision > loaded.revision ? remote : loaded, 'recovered', [...(recovery ?? []), ...(pending ? [pending] : [])]);
  }
  async function flush() {
    if (busy) return;
    busy = true; failure = null; callbacks.saving(true);
    try {
      if (recovery) {
        // An unknown write outcome must be read before another save. Keep the
        // ordered edits intact if this read also fails, including later gestures.
        try { await reload(); }
        catch (error) { failure = error; callbacks.error(error); return; }
      }
      while (pending) {
        const edit = pending; pending = null;
        try {
          const { undoHistory, undoOrigin, ...request } = edit;
          const undoHistoryKeys = undoHistory ? await Promise.all(undoHistory.map(timelineHistoryKey)) : undefined;
          const undoTargetKey = request.undoTo ? await timelineHistoryKey(undoOrigin ?? request.undoTo) : undefined;
          const snapshot = await callbacks.save({ ...request, ...(undoHistoryKeys ? { undoHistoryKeys } : {}), ...(undoTargetKey ? { undoTargetKey } : {}), expectedRevision: saved.revision });
          adopt(snapshot, 'saved', pending ? [pending] : []);
        } catch (error) {
          failure = error; callbacks.error(error);
          recovery = [edit, ...(pending ? [pending] : [])]; pending = null;
          try { await reload(); }
          catch (loadError) { callbacks.error(loadError); }
          break; // No automatic retry loop after a failed request.
        }
      }
    } finally {
      busy = false; receive(remote); callbacks.saving(false);
      if (!pending && !recovery) failure = null;
      waiters.splice(0).forEach(waiter => failure ? waiter.reject(failure) : waiter.resolve());
    }
  }
  return {
    receive,
    edit(next: Timeline, undo = false, undoHistory?: Timeline[]) {
      next = normalizeTimeline(next);
      pending = {
        baseTimeline: pending?.baseTimeline ?? visible, timeline: next,
        ...(undo ? { undoTo: next, undoOrigin: next, ...(undoHistory ? { undoHistory: undoHistory.slice(-40) } : {}) } : pending?.undoTo ? { undoTo: pending.undoTo, undoOrigin: pending.undoOrigin ?? pending.undoTo, ...(pending.undoHistory ? { undoHistory: pending.undoHistory } : {}) } : {}),
      };
      visible = next; void flush();
    },
    get busy() { return busy || !!pending || !!recovery; },
    wait: () => {
      if (!busy && !pending && !recovery) return Promise.resolve();
      const completion = new Promise<void>((resolve, reject) => waiters.push({ resolve, reject }));
      if (!busy) void flush();
      return completion;
    },
  };
}
