// Per-browser preferences. Storage can be unavailable (private mode, blocked
// site data, the server), so every read and write is guarded.

export function readStoredPreference(key: string): string | null {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

/** null removes the preference. */
export function writeStoredPreference(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
  catch { /* Keep the preference for this session when storage is unavailable. */ }
}
