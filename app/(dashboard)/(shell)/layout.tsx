import type { ReactNode } from 'react';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';

/**
 * Pages with the sidebar and navbar. The editor and the MCP consent page sit outside this group.
 * Nothing here reads the request, so every page under it is static and a click between them needs no server render.
 * proxy.ts sends signed-out visitors to sign-in; the root layout's pre-paint script draws a collapsed sidebar collapsed.
 */
export default function ShellLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
