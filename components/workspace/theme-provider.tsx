'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/** Workspace pages are always dark; the landing page and sign-in keep their own light design. */
export function WorkspaceThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  useEffect(() => {
    const internal = pathname !== '/' && !pathname.startsWith('/sign-in') && !pathname.startsWith('/sign-up');
    const applied = internal ? 'dark' : 'light';
    document.documentElement.dataset.workspaceTheme = applied;
    document.documentElement.classList.toggle('dark', internal);
    document.documentElement.style.colorScheme = applied;
  }, [pathname]);
  return children;
}
