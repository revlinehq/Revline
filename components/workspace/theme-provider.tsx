'use client';

import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';

export type WorkspaceTheme = 'light' | 'dark';
export const WORKSPACE_THEME_STORAGE_KEY = 'revline:workspace-theme';
const themeEvent = 'revline:theme-change';
let fallbackTheme: WorkspaceTheme = 'light';

function readTheme(): WorkspaceTheme {
  try { return localStorage.getItem(WORKSPACE_THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'; }
  catch { return fallbackTheme; }
}
function subscribe(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener(themeEvent, listener);
  return () => { window.removeEventListener('storage', listener); window.removeEventListener(themeEvent, listener); };
}
function saveTheme(theme: WorkspaceTheme) {
  fallbackTheme = theme;
  try { localStorage.setItem(WORKSPACE_THEME_STORAGE_KEY, theme); } catch { /* Preferences still work when storage is unavailable. */ }
  window.dispatchEvent(new Event(themeEvent));
}
const ThemeContext = createContext<{ theme: WorkspaceTheme; setTheme: (theme: WorkspaceTheme) => void; toggleTheme: () => void } | null>(null);

export function WorkspaceThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore<WorkspaceTheme>(subscribe, readTheme, () => 'light');
  const pathname = usePathname();
  useEffect(() => {
    const internal = pathname !== '/' && !pathname.startsWith('/sign-in') && !pathname.startsWith('/sign-up');
    const applied = internal ? theme : 'light';
    document.documentElement.dataset.workspaceTheme = applied;
    document.documentElement.classList.toggle('dark', applied === 'dark');
    document.documentElement.style.colorScheme = applied;
  }, [pathname, theme]);
  return <ThemeContext.Provider value={{ theme, setTheme: saveTheme, toggleTheme: () => saveTheme(theme === 'light' ? 'dark' : 'light') }}>{children}</ThemeContext.Provider>;
}

export function useWorkspaceTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('WorkspaceThemeProvider is required for workspace theme controls');
  return context;
}
