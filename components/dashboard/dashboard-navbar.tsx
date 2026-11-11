'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { WorkspaceAccountMenu } from '@/components/workspace/account-menu';
import { activeDashboardItem } from './dashboard-nav';

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
 * The 56px top bar of every page in the signed-in shell: page name on the left, then anything the page adds
 * (a switch, filters), with the bell and account avatar on the right. `back` replaces the name with a Back pill.
 * The name is a label, not a heading: each page keeps its own <h1>. Its contents sit in the same centred
 * column as the page below (dashboard.css `--dash-navbar-column`); the background and border run full width.
 */
export function DashboardNavbar({ title, back, children, actions }: { title?: string; back?: { href: string; label?: string }; children?: ReactNode; actions?: ReactNode }) {
  const pathname = usePathname();
  const name = title ?? activeDashboardItem(pathname)?.label ?? 'Revline';
  return <header className="dash-navbar">
    <SidebarTrigger className="dash-navbar-menu" aria-label="Open the menu" />
    {back ? <Button asChild variant="soft" className="dash-navbar-back"><Link href={back.href}><ChevronLeft aria-hidden="true" />{back.label ?? 'Back'}</Link></Button> : <span className="dash-navbar-title">{name}</span>}
    {children}
    <div className="dash-navbar-actions">{actions}<NotificationsBell /><WorkspaceAccountMenu shell /></div>
  </header>;
}
