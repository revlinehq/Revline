'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { readStoredPreference, writeStoredPreference } from '@/lib/stored-preference';

// Per-browser viewing preferences. Reads and writes are guarded, and the
// current session keeps the latest choice in memory when storage is unavailable.
const sessionValues = new Map<string, string | null>();
const changedEvent = 'revline:preference-changed';

function currentValue(key: string) {
  return sessionValues.has(key) ? sessionValues.get(key)! : readStoredPreference(key);
}

function subscribe(key: string, onChange: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) { sessionValues.delete(key); onChange(); }
  };
  window.addEventListener('storage', storage);
  window.addEventListener(changedEvent, onChange);
  return () => { window.removeEventListener('storage', storage); window.removeEventListener(changedEvent, onChange); };
}

/** A stored string preference shared by every component using the same key, kept in sync across tabs. */
export function useStoredPreference<T>(key: string, decode: (stored: string | null) => T, encode: (value: T) => string) {
  const stored = useSyncExternalStore(useCallback(onChange => subscribe(key, onChange), [key]), () => currentValue(key), () => null);
  const save = useCallback((value: T) => {
    const next = encode(value);
    sessionValues.set(key, next);
    writeStoredPreference(key, next);
    window.dispatchEvent(new Event(changedEvent));
  }, [key, encode]);
  return [decode(stored), save] as const;
}
