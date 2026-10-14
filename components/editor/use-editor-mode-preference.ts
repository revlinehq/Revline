'use client';

import { useSyncExternalStore } from 'react';

type EditorMode = 'agentic' | 'tracks';
export const EDITOR_MODE_STORAGE_KEY = 'revline-editor-mode';
const changedEvent = 'revline:editor-mode-changed';
let sessionMode: EditorMode | undefined;

function readMode(): EditorMode {
  if (sessionMode) return sessionMode;
  try {
    const saved = localStorage.getItem(EDITOR_MODE_STORAGE_KEY);
    if (saved === 'agentic' || saved === 'tracks') return saved;
  } catch { /* Keep editing when browser storage is unavailable. */ }
  return 'agentic';
}

function subscribe(onChange: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === EDITOR_MODE_STORAGE_KEY || event.key === null) { sessionMode = undefined; onChange(); }
  };
  window.addEventListener('storage', storage);
  window.addEventListener(changedEvent, onChange);
  return () => {
    window.removeEventListener('storage', storage);
    window.removeEventListener(changedEvent, onChange);
  };
}

function saveMode(mode: EditorMode) {
  sessionMode = mode;
  try { localStorage.setItem(EDITOR_MODE_STORAGE_KEY, mode); }
  catch { /* The current session still keeps the selected mode. */ }
  window.dispatchEvent(new Event(changedEvent));
}

export function useEditorModePreference() {
  const mode = useSyncExternalStore(subscribe, readMode, () => 'agentic' as const);
  return [mode, saveMode] as const;
}
