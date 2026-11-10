'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { isDarkRoute } from '@/lib/workspace-routes';

/** Every page is dark except sign-in and sign-up, which keep their own light design. */
export function WorkspaceThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  useEffect(() => {
    const internal = isDarkRoute(pathname);
    const applied = internal ? 'dark' : 'light';
    document.documentElement.dataset.workspaceTheme = applied;
    document.documentElement.classList.toggle('dark', internal);
    document.documentElement.style.colorScheme = applied;
  }, [pathname]);
  return children;
}
