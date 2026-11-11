'use client';

import { usePathname } from 'next/navigation';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { WorkspaceAccountLink } from '@/components/workspace/account-link';
import { dashboardPageTitle } from './dashboard-nav';

/**
 * The 56px top bar of every page in the signed-in shell, rendered once by DashboardShell: page name on the left,
 * account avatar on the right, a link to Settings.
 * The name is a label, not a heading: each page keeps its own <h1>. Its contents sit in the same centred
 * column as the page below (dashboard.css `--dash-column-pad`); the background and border run full width.
 * The name comes from the address (dashboard-nav.ts), so pages pass nothing.
 */
export function DashboardNavbar() {
  const pathname = usePathname();
  return <header className="dash-navbar">
    <SidebarTrigger className="dash-navbar-menu" aria-label="Open the menu" />
    <span className="dash-navbar-title">{dashboardPageTitle(pathname)}</span>
    {/* A page may put its own actions here (createPortal); the Library shows New folder and Upload on a phone. */}
    <div className="dash-navbar-actions"><div id="dash-navbar-page" className="dash-navbar-page" /><WorkspaceAccountLink shell /></div>
  </header>;
}
