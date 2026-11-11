import { ChartPie, Clapperboard, Megaphone, Plug, Send, Settings, type LucideIcon } from 'lucide-react';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';

export type DashboardNavItem = { label: string; href: string; icon: LucideIcon; /** Path prefixes that mark this item active; defaults to its href. */ match?: string[]; /** Pages under this item show a Back pill to it instead of a name. */ backFromSubpages?: boolean };

/** The signed-in sidebar: flat groups, in the order the design shows them. */
export const DASHBOARD_NAV: { label: string; items: DashboardNavItem[] }[] = [
  { label: 'Browse', items: [
    { label: 'Campaigns', href: '/campaigns', icon: Megaphone, backFromSubpages: true },
    { label: 'Stats', href: '/stats', icon: ChartPie },
  ] },
  { label: 'Tools', items: [
    { label: 'AI Editor', href: NEW_PROJECT_PATH, icon: Clapperboard, match: [NEW_PROJECT_PATH, '/chats'] },
    { label: 'Posts', href: '/posts', icon: Send },
  ] },
  { label: 'Account', items: [
    { label: 'Settings', href: '/profile', icon: Settings },
    { label: 'Connected accounts', href: '/accounts', icon: Plug },
  ] },
];

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

export function activeDashboardItem(pathname: string | null) {
  if (!pathname) return undefined;
  return DASHBOARD_NAV.flatMap(group => group.items).find(item => (item.match ?? [item.href]).some(prefix => under(pathname, prefix)));
}

/** Shell pages that are not a sidebar item's own page, and the name the navbar shows for them. */
const PAGE_TITLES: [prefix: string, title: string][] = [['/chats', 'Your chats'], ['/storage', 'Cloud storage'], ['/chat', 'AI Editor']];

/** The navbar's name for a page: the sidebar item's label on its own page and the pages under it, else the table above. */
export function dashboardPageTitle(pathname: string | null) {
  if (!pathname) return 'Revline';
  const item = DASHBOARD_NAV.flatMap(group => group.items).find(item => under(pathname, item.href));
  return item?.label ?? PAGE_TITLES.find(([prefix]) => under(pathname, prefix))?.[1] ?? 'Revline';
}
