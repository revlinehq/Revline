'use client';

import { useCallback, useSyncExternalStore } from 'react';

// Per-browser viewing preferences. Storage can be unavailable (private mode,
// blocked site data), so every read and write is guarded and the current
// session keeps the latest choice in memory.
const sessionValues = new Map<string, string | null>();
const changedEvent = 'revline:preference-changed';

export function readStoredPreference(key: string): string | null {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

/** null removes the preference. */
export function writeStoredPreference(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
  catch { /* Keep the preference for this session when storage is unavailable. */ }
}

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
