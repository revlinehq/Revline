'use client';

import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { WorkspaceAccountMenu } from '@/components/workspace/account-menu';
import { activeDashboardItem, dashboardPageTitle } from './dashboard-nav';
import { DashboardNavbarContext } from './shell-context';

/** The bell. No notification source exists yet, so it says so and shows no unread dot. A menu like the account one beside it, so both open the same way. */
function NotificationsBell() {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="dash-bell" aria-label="Notifications"><Bell fill="currentColor" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" sideOffset={12} className="workspace-menu dash-notifications">
      <DropdownMenuLabel asChild><h2>Notifications</h2></DropdownMenuLabel>
      <p>No notifications yet.</p>
    </DropdownMenuContent>
  </DropdownMenu>;
}

/**
 * The 56px top bar of every page in the signed-in shell, rendered once by DashboardShell: page name on the left,
 * then anything the page adds (a switch, filters), with the bell and account avatar on the right.
 * The name is a label, not a heading: each page keeps its own <h1>. Its contents sit in the same centred
 * column as the page below (dashboard.css `--dash-column-pad`); the background and border run full width.
 * The name comes from the address (dashboard-nav.ts), so pages pass nothing; pages under Campaigns show a Back pill.
 */
export function DashboardNavbar({ itemsRef }: { itemsRef: (element: HTMLElement | null) => void }) {
  const pathname = usePathname();
  const item = activeDashboardItem(pathname);
  const back = item?.backFromSubpages && pathname !== item.href ? item.href : undefined;
  return <header className="dash-navbar">
    <SidebarTrigger className="dash-navbar-menu" aria-label="Open the menu" />
    {back ? <Button asChild variant="soft" className="dash-navbar-back"><Link href={back}><ChevronLeft aria-hidden="true" />Back</Link></Button>
      : <span className="dash-navbar-title">{dashboardPageTitle(pathname)}</span>}
    <div ref={itemsRef} className="dash-navbar-items" />
    <div className="dash-navbar-actions"><NotificationsBell /><WorkspaceAccountMenu shell /></div>
  </header>;
}

/** Controls a page puts in the navbar, after its name (the Campaigns switch). They appear once the page has mounted. */
export function DashboardNavbarItems({ children }: { children: ReactNode }) {
  const items = useContext(DashboardNavbarContext);
  return items ? createPortal(children, items) : null;
}
