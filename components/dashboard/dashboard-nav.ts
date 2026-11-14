import { ChartNoAxesColumn, Clapperboard, Folder, LifeBuoy, Plug, Send, Settings, type LucideIcon } from 'lucide-react';
import { DISCORD_URL } from '@/components/workspace/discord-link';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';

export type DashboardNavItem = { label: string; href: string; icon: LucideIcon; /** The icon is made of open strokes (bars, lines): the sidebar thickens them instead of filling the shape. */ strokeIcon?: boolean; /** Path prefixes that mark this item active; defaults to its href. */ match?: string[]; /** Opens another site in a new tab: never active, never prefetched. */ external?: boolean };

/** The signed-in sidebar: flat groups, in the order the design shows them. */
export const DASHBOARD_NAV: { label: string; items: DashboardNavItem[] }[] = [
  { label: 'Create', items: [
    { label: 'AI Editor', href: NEW_PROJECT_PATH, icon: Clapperboard, match: [NEW_PROJECT_PATH, '/chats'] },
    { label: 'Library', href: '/library', icon: Folder },
  ] },
  { label: 'Publish', items: [
    { label: 'Posts', href: '/posts', icon: Send },
    { label: 'Stats', href: '/stats', icon: ChartNoAxesColumn, strokeIcon: true },
  ] },
  { label: 'Account', items: [
    { label: 'Settings', href: '/profile', icon: Settings },
    { label: 'Connected accounts', href: '/accounts', icon: Plug },
    { label: 'Support', href: DISCORD_URL, icon: LifeBuoy, external: true },
  ] },
];

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

export function activeDashboardItem(pathname: string | null) {
  if (!pathname) return undefined;
  return DASHBOARD_NAV.flatMap(group => group.items).find(item => (item.match ?? [item.href]).some(prefix => under(pathname, prefix)));
}

/** Pages that carry their own header row in place of the navbar: the phone menu button sits in it (DashboardMenuButton). */
const PAGES_WITHOUT_NAVBAR = ['/posts'];

export function dashboardShowsNavbar(pathname: string | null) {
  return !pathname || !PAGES_WITHOUT_NAVBAR.some(prefix => under(pathname, prefix));
}

/** Shell pages that are not a sidebar item's own page, and the name the navbar shows for them. */
const PAGE_TITLES: [prefix: string, title: string][] = [['/chats', 'Your projects']];

/** The navbar's name for a page: the sidebar item's label on its own page and the pages under it, else the table above. */
export function dashboardPageTitle(pathname: string | null) {
  if (!pathname) return 'Revline';
  const item = DASHBOARD_NAV.flatMap(group => group.items).find(item => under(pathname, item.href));
  return item?.label ?? PAGE_TITLES.find(([prefix]) => under(pathname, prefix))?.[1] ?? 'Revline';
}
