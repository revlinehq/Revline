'use client';

import { useRef, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { startNewWorkspace } from '@/components/workspace/start-new-workspace';
import { NEW_PROJECT_PATH, SIGNED_IN_HOME_PATH } from '@/lib/workspace-routes';
import { DashboardShellContext } from './shell-context';
import { DashboardNavbar } from './dashboard-navbar';
import { DASHBOARD_NAV, activeDashboardItem, type DashboardNavItem } from './dashboard-nav';
import './dashboard.css';

function NavRow({ item, active }: { item: DashboardNavItem; active: boolean }) {
  const { setOpenMobile } = useSidebar();
  const router = useRouter();
  const { user } = useUser();
  const Icon = item.icon;
  const starting = useRef(false);
  // "AI Editor" starts a fresh workspace, as the old brand link did, so a finished import is not resumed.
  async function open(event: MouseEvent<HTMLAnchorElement>) {
    setOpenMobile(false);
    if (item.href !== NEW_PROJECT_PATH || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (starting.current) return;
    starting.current = true;
    try { await startNewWorkspace(user?.id); } catch { /* The start page still opens with the previous draft. */ }
    finally { starting.current = false; }
    router.push(NEW_PROJECT_PATH);
  }
  return <SidebarMenuItem><SidebarMenuButton asChild isActive={active} tooltip={item.label} className="dash-nav-row">
    <Link href={item.href} data-icon-style={item.strokeIcon ? 'stroke' : undefined} aria-current={active ? 'page' : undefined} onClick={event => void open(event)}><Icon aria-hidden="true" /><span>{item.label}</span></Link>
  </SidebarMenuButton></SidebarMenuItem>;
}

export function DashboardShell({ children, defaultOpen = true }: { children: ReactNode; defaultOpen?: boolean }) {
  const active = activeDashboardItem(usePathname());
  return <DashboardShellContext.Provider value={true}>
    <SidebarProvider defaultOpen={defaultOpen} className="dash-shell dash-theme" style={{ '--sidebar-width': 'var(--dash-sidebar-width)' } as React.CSSProperties}>
      <Sidebar collapsible="icon" className="dash-sidebar">
        <SidebarHeader className="dash-sidebar-header"><Link href={SIGNED_IN_HOME_PATH} className="dash-wordmark">Revline</Link><SidebarTrigger className="dash-sidebar-toggle" aria-label="Collapse or expand the sidebar" /></SidebarHeader>
        <SidebarContent className="dash-sidebar-content">
          {DASHBOARD_NAV.map(group => <SidebarGroup key={group.label} className="dash-nav-group">
            <SidebarGroupLabel className="dash-nav-label">{group.label}</SidebarGroupLabel>
            <SidebarMenu className="dash-nav-list">{group.items.map(item => <NavRow key={item.href} item={item} active={item === active} />)}</SidebarMenu>
          </SidebarGroup>)}
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="dash-main">
        <DashboardNavbar />
        {children}
      </SidebarInset>
    </SidebarProvider>
  </DashboardShellContext.Provider>;
}
