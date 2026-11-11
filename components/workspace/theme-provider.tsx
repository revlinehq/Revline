'use client';

import { useEffect } from 'react';

/** Every page is dark; this keeps the document flags set after hydration. */
export function WorkspaceThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.dataset.workspaceTheme = 'dark';
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
  }, []);
  return children;
}
