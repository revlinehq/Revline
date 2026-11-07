import { deriveTrackCounts, normalizeTimeline, TIMELINE_LAYER_GROUPS, type Clip, type Timeline } from './types';
import { reconcileTransitionEdits } from './clip-transitions';
import { LOCAL_UNDO_LIMIT, timelineHistoryKey } from './timeline-history-key';
import { equalTimelineValue as equal } from './timeline-equality';

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
      if (old.kind !== edited.kind) {
        if (edited.kind === undefined) delete updated.kind;
        else updated.kind = edited.kind;
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
export const TIMELINE_LOCKED = 'Revline is editing your timeline. Wait for it to finish or stop the edit before making changes.';
export const TIMELINE_CONFLICT = 'The timeline changed elsewhere. Reload before saving.';
const RETRY_DELAYS = [1000, 2000, 5000, 10000, 30000];
/** Application rejections are deterministic unless they report the AI lock, a
 * stale revision, or access (coded) state. Network and server faults are not. */
function rejectedEdit(error: unknown) {
  const data = error && typeof error === 'object' && 'data' in error ? error.data : undefined;
  return typeof data === 'string' && data !== TIMELINE_LOCKED && !/timeline changed elsewhere/i.test(data) && data !== 'Authentication required';
}
type PendingEdit = { baseTimeline: Timeline; timeline: Timeline; undoTo?: Timeline; undoHistoryKeys?: string[]; undoTargetKey?: string };
type QueuedEdit = Omit<PendingEdit, 'undoHistoryKeys' | 'undoTargetKey'> & { undoHistory?: Timeline[]; undoOrigin?: Timeline };
type SaveCallbacks = {
  save: (edit: PendingEdit & { expectedRevision: number }) => Promise<TimelineSnapshot>;
  load: () => Promise<TimelineSnapshot>;
  update: (timeline: Timeline, kind: 'saved' | 'remote' | 'recovered', history?: Timeline[]) => void;
  saving: (busy: boolean) => void;
  /** `rejected`: the server refused this edit outright, so it was rolled back. */
  error: (error: unknown, rejected?: boolean) => void;
  /** Unsaved edits remain after a failed attempt; retries continue in the background. */
  failed?: (failed: boolean) => void;
};

// One queue per project. Keep acknowledged state separate from optimistic edits.
export function createTimelineSaveQueue(initial: TimelineSnapshot, callbacks: SaveCallbacks) {
  initial = { ...initial, timeline: normalizeTimeline(initial.timeline) };
  let saved = initial, visible = initial.timeline, remote = initial;
  let pending: QueuedEdit | null = null, recovery: QueuedEdit[] | null = null;
  let busy = false, failure: unknown = null, attempts = 0, notified = false, timer: ReturnType<typeof setTimeout> | undefined;
  const waiters: { resolve: () => void; reject: (error: unknown) => void }[] = [];
  function retry(delay = 0) {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; if (!busy && (pending || recovery)) void flush(); }, delay);
  }
  // Background retries keep the unsaved indicator instead of repeating the notice.
  function report(error: unknown) { if (!notified) { notified = true; callbacks.error(error); } }
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
    if (!failure) return;
    // A newer revision settles a lost write or ends the AI lock: retry now.
    if (pending) retry(); else { failure = null; notified = false; callbacks.failed?.(false); }
  }
  async function reload(kind: 'recovered' | 'remote' = 'recovered') {
    const loaded = await callbacks.load();
    adopt(remote.revision > loaded.revision ? remote : loaded, kind, [...(recovery ?? []), ...(pending ? [pending] : [])]);
  }
  async function flush() {
    if (busy) return;
    clearTimeout(timer); timer = undefined;
    busy = true; failure = null; callbacks.saving(true);
    try {
      if (recovery) {
        // An unknown write outcome must be read before another save. Keep the
        // ordered edits intact if this read also fails, including later gestures.
        try { await reload(); }
        catch (error) { failure = error; report(error); return; }
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
          if (rejectedEdit(error)) {
            // Retrying a deterministic rejection would block every later save.
            // The mutation rolled back: drop this edit and rebase later gestures.
            // A dropped undo also resets the local stacks to the server history.
            callbacks.error(error, true);
            recovery = pending ? [pending] : []; pending = null;
            try { await reload(edit.undoTo ? 'remote' : 'recovered'); continue; }
            catch (loadError) { failure = loadError; break; }
          }
          failure = error; report(error);
          recovery = [edit, ...(pending ? [pending] : [])]; pending = null;
          try { await reload(); }
          catch (loadError) { report(loadError); }
          break; // Retries are scheduled below, after this flush settles.
        }
      }
    } finally {
      busy = false; receive(remote); callbacks.saving(false);
      if (!pending && !recovery) failure = null;
      if (!failure) { attempts = 0; notified = false; }
      else if (!timer && attempts < RETRY_DELAYS.length) retry(RETRY_DELAYS[attempts++]);
      callbacks.failed?.(!!failure);
      waiters.splice(0).forEach(waiter => failure ? waiter.reject(failure) : waiter.resolve());
    }
  }
  return {
    receive,
    edit(next: Timeline, undo = false, undoHistory?: Timeline[]) {
      next = normalizeTimeline(next);
      pending = {
        baseTimeline: pending?.baseTimeline ?? visible, timeline: next,
        ...(undo ? { undoTo: next, undoOrigin: next, ...(undoHistory ? { undoHistory: undoHistory.slice(-LOCAL_UNDO_LIMIT) } : {}) } : pending?.undoTo ? { undoTo: pending.undoTo, undoOrigin: pending.undoOrigin ?? pending.undoTo, ...(pending.undoHistory ? { undoHistory: pending.undoHistory } : {}) } : {}),
      };
      visible = next; void flush();
    },
    /** Retry unsaved edits now, e.g. when the browser reconnects or the AI lock lifts. */
    retry() { attempts = 0; notified = false; if (!busy && (pending || recovery)) retry(); },
    get busy() { return busy || !!pending || !!recovery; },
    get failed() { return !!failure; },
    wait: () => {
      if (!busy && !pending && !recovery) return Promise.resolve();
      const completion = new Promise<void>((resolve, reject) => waiters.push({ resolve, reject }));
      if (!busy) void flush();
      return completion;
    },
  };
}
