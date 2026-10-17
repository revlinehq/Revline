'use client';

import { useSyncExternalStore } from 'react';

export const INSPECTOR_STORAGE_KEY = 'revline-inspector-open';
const changedEvent = 'revline:inspector-changed';
let sessionOpen: boolean | undefined;

function readOpen() {
  if (sessionOpen !== undefined) return sessionOpen;
  try { return localStorage.getItem(INSPECTOR_STORAGE_KEY) === 'true'; }
  catch { return false; }
}

function subscribe(onChange: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === INSPECTOR_STORAGE_KEY || event.key === null) { sessionOpen = undefined; onChange(); }
  };
  window.addEventListener('storage', storage);
  window.addEventListener(changedEvent, onChange);
  return () => { window.removeEventListener('storage', storage); window.removeEventListener(changedEvent, onChange); };
}

function saveOpen(open: boolean) {
  sessionOpen = open;
  try { localStorage.setItem(INSPECTOR_STORAGE_KEY, String(open)); }
  catch { /* Keep the preference for this session when storage is unavailable. */ }
  window.dispatchEvent(new Event(changedEvent));
}

export function useInspectorPreference() {
  return [useSyncExternalStore(subscribe, readOpen, () => false), saveOpen] as const;
}
