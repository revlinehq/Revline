'use client';

import { useCallback, useEffect, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import Link, { useLinkStatus } from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { PrefetchKind } from 'next/dist/client/components/router-reducer/router-reducer-types';
import { useUser } from '@clerk/nextjs';
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { startNewWorkspace } from '@/components/workspace/start-new-workspace';
import { NEW_PROJECT_PATH, SIGNED_IN_HOME_PATH, sidebarCookieCollapsed } from '@/lib/workspace-routes';
import { DashboardShellContext } from './shell-context';
import { DashboardNavbar } from './dashboard-navbar';
import { DASHBOARD_NAV, activeDashboardItem, type DashboardNavItem } from './dashboard-nav';
import './dashboard.css';

const NAV_ITEMS = DASHBOARD_NAV.flatMap(group => group.items);
/** The whole page, not only its loading frame, so the click itself asks the server nothing. */
const WHOLE_PAGE = { kind: 'full' as PrefetchKind };
const noSubscription = () => () => {};
/** Expanded unless the sidebar's cookie says collapsed. The static shell renders expanded on the server; until this is read, the root layout's pre-paint script and dashboard.css draw a collapsed one collapsed. */
const cookieSaysOpen = () => !sidebarCookieCollapsed(document.cookie);

/** Inside a sidebar link: tells the shell while that link's page is still on its way, and again when it arrives or fails. */
function NavPending({ onChange }: { onChange: (pending: boolean) => void }) {
  const { pending } = useLinkStatus();
  useEffect(() => { onChange(pending); return () => onChange(false); }, [pending, onChange]);
  return null;
}

function NavRow({ item, active, onPending }: { item: DashboardNavItem; active: boolean; onPending: (item: DashboardNavItem, pending: boolean) => void }) {
  const { setOpenMobile } = useSidebar();
  const { user } = useUser();
  const Icon = item.icon;
  const report = useCallback((pending: boolean) => onPending(item, pending), [item, onPending]);
  function open(event: MouseEvent<HTMLAnchorElement>) {
    setOpenMobile(false);
    // "AI Editor" starts a fresh workspace, as the old brand link did, so a finished import is not resumed. The draft is
    // dropped in memory at once and the page opens without waiting for the stored copy to be cleared.
    if (item.href === NEW_PROJECT_PATH && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) void startNewWorkspace(user?.id).catch(() => { /* The start page still opens with the previous draft. */ });
  }
  return <SidebarMenuItem><SidebarMenuButton asChild isActive={active} tooltip={item.label} className="dash-nav-row">
    <Link href={item.href} prefetch data-icon-style={item.strokeIcon ? 'stroke' : undefined} aria-current={active ? 'page' : undefined} onClick={open}><NavPending onChange={report} /><Icon aria-hidden="true" /><span>{item.label}</span></Link>
  </SidebarMenuButton></SidebarMenuItem>;
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // A clicked item is marked at once, while its page is still on the way, not when the page arrives.
  const [arriving, setArriving] = useState<DashboardNavItem | null>(null);
  const onPending = useCallback((item: DashboardNavItem, pending: boolean) => setArriving(current => pending ? item : current === item ? null : current), []);
  const active = arriving ?? activeDashboardItem(pathname);
  const remembered = useSyncExternalStore(noSubscription, cookieSaysOpen, () => true);
  const [chosen, setChosen] = useState<boolean>();
  const open = chosen ?? remembered;
  // The pre-paint mark has done its job once the sidebar's own state says what the cookie says.
  useEffect(() => { if (open === cookieSaysOpen()) delete document.documentElement.dataset.sidebarCollapsed; }, [open]);
  // Every sidebar page is loaded ahead of the click, including on a phone, where the links are not on screen until the
  // menu opens. Asked again after each navigation, so the page just left is loaded too; a page already held is not fetched twice.
  useEffect(() => { for (const item of NAV_ITEMS) router.prefetch(item.href, WHOLE_PAGE); }, [router, pathname]);
  return <DashboardShellContext.Provider value={true}>
    <SidebarProvider open={open} onOpenChange={setChosen} className="dash-shell dash-theme" style={{ '--sidebar-width': 'var(--dash-sidebar-width)' } as React.CSSProperties}>
      <Sidebar collapsible="icon" className="dash-sidebar">
        <SidebarHeader className="dash-sidebar-header"><Link href={SIGNED_IN_HOME_PATH} prefetch className="dash-wordmark">Revline</Link><SidebarTrigger className="dash-sidebar-toggle" aria-label="Collapse or expand the sidebar" /></SidebarHeader>
        <SidebarContent className="dash-sidebar-content">
          {DASHBOARD_NAV.map(group => <SidebarGroup key={group.label} className="dash-nav-group">
            <SidebarGroupLabel className="dash-nav-label">{group.label}</SidebarGroupLabel>
            <SidebarMenu className="dash-nav-list">{group.items.map(item => <NavRow key={item.href} item={item} active={item === active} onPending={onPending} />)}</SidebarMenu>
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
