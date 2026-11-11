import { ChartNoAxesColumn, Clapperboard, Cloud, Plug, Send, Settings, type LucideIcon } from 'lucide-react';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';

export type DashboardNavItem = { label: string; href: string; icon: LucideIcon; /** The icon is made of open strokes (bars, lines): the sidebar thickens them instead of filling the shape. */ strokeIcon?: boolean; /** Path prefixes that mark this item active; defaults to its href. */ match?: string[] };

/** The signed-in sidebar: flat groups, in the order the design shows them. */
export const DASHBOARD_NAV: { label: string; items: DashboardNavItem[] }[] = [
  { label: 'Create', items: [
    { label: 'AI Editor', href: NEW_PROJECT_PATH, icon: Clapperboard, match: [NEW_PROJECT_PATH, '/chats'] },
  ] },
  { label: 'Publish', items: [
    { label: 'Posts', href: '/posts', icon: Send },
    { label: 'Stats', href: '/stats', icon: ChartNoAxesColumn, strokeIcon: true },
  ] },
  { label: 'Account', items: [
    { label: 'Settings', href: '/profile', icon: Settings },
    { label: 'Connected accounts', href: '/accounts', icon: Plug },
    { label: 'Cloud storage', href: '/storage', icon: Cloud },
  ] },
];

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

export function activeDashboardItem(pathname: string | null) {
  if (!pathname) return undefined;
  return DASHBOARD_NAV.flatMap(group => group.items).find(item => (item.match ?? [item.href]).some(prefix => under(pathname, prefix)));
}

/** Shell pages that are not a sidebar item's own page, and the name the navbar shows for them. */
const PAGE_TITLES: [prefix: string, title: string][] = [['/chats', 'Your projects']];

/** The navbar's name for a page: the sidebar item's label on its own page and the pages under it, else the table above. */
export function dashboardPageTitle(pathname: string | null) {
  if (!pathname) return 'Revline';
  const item = DASHBOARD_NAV.flatMap(group => group.items).find(item => under(pathname, item.href));
  return item?.label ?? PAGE_TITLES.find(([prefix]) => under(pathname, prefix))?.[1] ?? 'Revline';
}
