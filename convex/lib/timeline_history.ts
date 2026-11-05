import { normalizeTimeline, type Timeline } from '../../lib/editor/types';

// Undo-history budgets, shared by the timeline commit (timeline.ts) and the project writer (project_data.ts).

export function serializedBytes(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
/** Stored undo snapshots: the newest entries within both budgets. */
export const HISTORY_LIMIT = 10, HISTORY_BYTES = 500_000;
export function boundedEntries<T extends { timeline?: Timeline; id?: unknown; bytes?: number }>(entries: T[]): T[] {
  // Stored rows were normalized when written; only new snapshots need it.
  const kept = entries.slice(-HISTORY_LIMIT).map(entry => entry.id ? entry : { ...entry, timeline: normalizeTimeline(entry.timeline!) });
  // Serialized array bytes: entries, separating commas, and brackets. Stored rows carry their size.
  const sizes = kept.map(entry => entry.bytes ?? serializedBytes(entry.timeline));
  let total = sizes.reduce((sum, size) => sum + size, 0) + Math.max(kept.length - 1, 0) + 2;
  while (kept.length && total > HISTORY_BYTES) { total -= sizes.shift()! + (kept.length > 1 ? 1 : 0); kept.shift(); }
  return kept;
}
