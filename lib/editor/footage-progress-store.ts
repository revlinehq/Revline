'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { clampProgress } from './footage-progress';

const values = new Map<string, number>();
const listeners = new Set<() => void>();
const prefix = 'revline:footage-progress:v1:';
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

function savedProgress(key: string) {
  if (values.has(key)) return values.get(key)!;
  let value = 0;
  try { value = clampProgress(Number(sessionStorage.getItem(prefix + key))); } catch { /* Memory still retains progress when storage is unavailable. */ }
  values.set(key, value);
  return value;
}

/** Keep the high-water mark outside the view so retries, remounts and handoffs agree. */
export function rememberFootageProgress(key: string, percent: number) {
  const previous = savedProgress(key), next = Math.max(previous, clampProgress(percent));
  if (next > previous) {
    values.set(key, next);
    try { sessionStorage.setItem(prefix + key, String(next)); } catch { /* Keep the in-memory value. */ }
    for (const listener of listeners) listener();
  }
  return next;
}

/** A completed opening is a new operation next time; an interrupted one resumes. */
export function beginFootageOpening(projectId: string) {
  if (typeof window === 'undefined') return;
  const key = `project:${projectId}`;
  if (savedProgress(key) === 100) {
    values.set(key, 0);
    try { sessionStorage.removeItem(prefix + key); } catch { /* Keep the in-memory reset. */ }
  }
}

export function useFootageProgress(key: string | undefined, candidate = 0) {
  const snapshot = useCallback(() => key ? savedProgress(key) : 0, [key]);
  const saved = useSyncExternalStore(subscribe, snapshot, () => 0);
  const progress = Math.max(saved, clampProgress(candidate));
  useEffect(() => { if (key) rememberFootageProgress(key, progress); }, [key, progress]);
  return progress;
}
