import { normalizeTimeline, type Timeline } from './types';

/** Local undo depth; a save sends at most this many history fingerprints. */
export const LOCAL_UNDO_LIMIT = 40;
/** Bump when canonical() or normalizeTimeline output changes: stored server
 * fingerprints from another version are recomputed instead of trusted. */
export const HISTORY_KEY_VERSION = 1;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}

/** Match snapshots without sending full local undo histories to the server. */
export async function timelineHistoryKey(timeline: Timeline): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(normalizeTimeline(timeline))));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
