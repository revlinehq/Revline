import { ChartPie, Clapperboard, Megaphone, Plug, Send, Settings, type LucideIcon } from 'lucide-react';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';

export type DashboardNavItem = { label: string; href: string; icon: LucideIcon; /** Path prefixes that mark this item active; defaults to its href. */ match?: string[] };

/** The signed-in sidebar: flat groups, in the order the design shows them. */
export const DASHBOARD_NAV: { label: string; items: DashboardNavItem[] }[] = [
  { label: 'Browse', items: [
    { label: 'Campaigns', href: '/campaigns', icon: Megaphone },
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
