'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { WorkspaceAccountMenu } from '@/components/workspace/account-menu';
import { activeDashboardItem } from './dashboard-nav';

/** The bell. No notification source exists yet, so it says so and shows no unread dot. */
function NotificationsBell() {
  return <Popover>
    <PopoverTrigger asChild><Button variant="ghost" size="icon" className="dash-bell" aria-label="Notifications"><Bell fill="currentColor" /></Button></PopoverTrigger>
    <PopoverContent align="end" sideOffset={8} className="dash-popover dash-notifications">
      <h2>Notifications</h2>
      <p>No notifications yet.</p>
    </PopoverContent>
  </Popover>;
}

/**
 * The 56px top bar of every page in the signed-in shell: page name on the left, then anything the page adds
 * (a switch, filters), with the bell and account avatar on the right. `back` replaces the name with a Back pill.
 * The name is a label, not a heading: each page keeps its own <h1>.
 */
export function DashboardNavbar({ title, back, children, actions }: { title?: string; back?: { href: string; label?: string }; children?: ReactNode; actions?: ReactNode }) {
  const pathname = usePathname();
  const name = title ?? activeDashboardItem(pathname)?.label ?? 'Revline';
  return <header className="dash-navbar">
    <SidebarTrigger className="dash-navbar-menu" aria-label="Open the menu" />
    {back ? <Button asChild variant="soft" size="sm"><Link href={back.href}><ArrowLeft aria-hidden="true" />{back.label ?? 'Back'}</Link></Button> : <span className="dash-navbar-title">{name}</span>}
    {children}
    <div className="dash-navbar-actions">{actions}<NotificationsBell /><WorkspaceAccountMenu shell /></div>
  </header>;
}
