import { deriveTrackCounts, normalizeTimeline, TIMELINE_LAYER_GROUPS, type Clip, type Timeline } from './types';
import { reconcileTransitionEdits } from './clip-transitions';

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

export type TimelineSnapshot = { timeline: Timeline; revision: number };
type PendingEdit = { baseTimeline: Timeline; timeline: Timeline };
type SaveCallbacks = {
  save: (edit: PendingEdit & { expectedRevision: number }) => Promise<TimelineSnapshot>;
  load: () => Promise<TimelineSnapshot>;
  update: (timeline: Timeline, kind: 'saved' | 'remote' | 'recovered') => void;
  saving: (busy: boolean) => void;
  error: (error: unknown) => void;
};

// One queue per project. Keep the acknowledged server snapshot separate from
// the optimistic view so rapid gestures never save an old whole-timeline snapshot.
export function createTimelineSaveQueue(initial: TimelineSnapshot, callbacks: SaveCallbacks) {
  let saved = initial, visible = initial.timeline, remote = initial;
  let pending: PendingEdit | null = null, busy = false;
  const waiters: (() => void)[] = [];
  function receive(snapshot: TimelineSnapshot) {
    if (snapshot.revision > remote.revision) remote = snapshot;
    if (busy || snapshot.revision <= saved.revision) return;
    saved = snapshot; visible = snapshot.timeline; callbacks.update(visible, 'remote');
  }
  async function flush() {
    if (busy) return;
    busy = true; callbacks.saving(true);
    try {
      while (pending) {
        const edit = pending; pending = null;
        saved = await callbacks.save({ ...edit, expectedRevision: saved.revision });
        // Further gestures were made against the optimistic edit, not this server
        // acknowledgement. Carry only their intent forward onto the saved result.
        if (pending) {
          const queued = pending as PendingEdit;
          visible = applyTimelineEdit(queued.baseTimeline, queued.timeline, saved.timeline);
          pending = { baseTimeline: saved.timeline, timeline: visible };
        } else visible = saved.timeline;
        callbacks.update(visible, 'saved');
      }
    } catch (error) {
      pending = null; callbacks.error(error);
      try { saved = await callbacks.load(); visible = saved.timeline; callbacks.update(visible, 'recovered'); }
      catch (loadError) { callbacks.error(loadError); }
    } finally {
      busy = false;
      receive(remote);
      callbacks.saving(false);
      waiters.splice(0).forEach(resolve => resolve());
    }
  }
  return {
    receive,
    edit(next: Timeline) {
      pending = { baseTimeline: pending?.baseTimeline ?? visible, timeline: next };
      visible = next; void flush();
    },
    get busy() { return busy; },
    wait: () => busy ? new Promise<void>(resolve => waiters.push(resolve)) : Promise.resolve(),
  };
}
