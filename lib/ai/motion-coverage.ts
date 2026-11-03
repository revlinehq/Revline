import type { Timeline } from '../editor/types';
import { withoutSceneCode } from '../editor/scene-code';
import type { MotionDifference } from '../inspo-motion/motion-map';

export type MotionWindow = { start: number; end: number };
export type MotionOff = MotionWindow & { time: number; reason: string };
export type MotionCheck = MotionWindow & { timelineStart: number; revision: number; timelineKey: string; scope: string; differences: MotionDifference[]; checkedAt: number };
const EPSILON = .001;
export const motionRange = ({ start, end }: MotionWindow) => `${Math.round(start * 1000) / 1000}–${Math.round(end * 1000) / 1000} s`;

/** Union adjoining reads, so tiny samples cannot stand in for an unread stretch. */
export function mergeMotionWindows(windows: MotionWindow[]) {
  const merged: MotionWindow[] = [];
  for (const window of [...windows].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && window.start <= last.end + EPSILON) last.end = Math.max(last.end, window.end);
    else merged.push({ ...window });
  }
  return merged;
}

export function missingMotionWindow(start: number, end: number, reads: MotionWindow[]) {
  let reached = start;
  for (const window of mergeMotionWindows(reads)) {
    if (window.end <= reached) continue;
    if (window.start > reached + EPSILON) return { start: reached, end: Math.min(end, window.start, reached + 12) };
    reached = window.end;
    if (reached >= end - EPSILON) return undefined;
  }
  return reached < end - EPSILON ? { start: reached, end: Math.min(end, reached + 12) } : undefined;
}

/** A saved revision alone cannot distinguish multiple edits to an unpublished draft. */
export async function motionTimelineKey(timeline: Timeline) {
  const stored = (await withoutSceneCode(timeline)).timeline;
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(stored))));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Off declarations remain separate from real measurements and never become a clean result. */
export function motionReport({ start, end, offset, revision, timelineKey, checks, off }: MotionWindow & { offset: number; revision: number; timelineKey: string; checks: MotionCheck[]; off: MotionOff[] }) {
  const relevant = checks.filter(check => check.end > start && check.start < end && Math.abs(check.timelineStart - check.start - offset) < EPSILON).sort((a, b) => a.start - b.start || a.end - b.end || a.scope.localeCompare(b.scope));
  const parts: string[] = [];
  const windows = mergeMotionWindows([...relevant.filter(check => check.scope === 'full').map(({ start, end }) => ({ start, end })), ...off]);
  for (const window of relevant) {
    const range = motionRange(window);
    const wholeWindowOff = !missingMotionWindow(window.start, window.end, off);
    const count = wholeWindowOff ? 0 : window.differences.filter(difference => !off.some(item => difference.time - offset >= item.start - EPSILON && difference.time - offset <= item.end + EPSILON)).length;
    const exempted = window.differences.length - count;
    const current = window.revision === revision && window.timelineKey === timelineKey;
    parts.push(`${count} open differences in ${range}${exempted ? `; ${exempted} differences OFF (not matched)` : ''}${window.scope === 'full' ? '' : ' (cropped)'}${current ? count ? '' : `; checked at revision ${revision}` : `; ${range} not re-checked since revision ${window.revision}`}`);
  }
  // Every uncovered stretch is named, including a tail beyond the last comparison.
  let next = start;
  while (next < end - EPSILON) {
    const gap = missingMotionWindow(next, end, windows);
    if (!gap) break;
    parts.push(`${motionRange(gap)} not checked`);
    next = gap.end;
  }
  for (const item of off) parts.push(`${motionRange(item)} OFF at ${item.time} s: ${item.reason} (not matched)`);
  return `motionMap: ${parts.join('; ') || 'no motion windows checked'}`;
}
