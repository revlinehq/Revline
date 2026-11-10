import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';

/** Pages with the sidebar and navbar. The editor and the MCP consent page sit outside this group. */
export default async function ShellLayout({ children }: { children: ReactNode }) {
  // The sidebar remembers collapsed or expanded in a cookie, so the first paint already matches.
  const collapsed = (await cookies()).get('sidebar_state')?.value === 'false';
  return <DashboardShell defaultOpen={!collapsed}>{children}</DashboardShell>;
}
