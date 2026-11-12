'use client';

import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { UserAvatar } from './user-avatar';

/**
 * The avatar in the editor and landing top bars: a plain link to Settings (/profile), where the profile, the plan and
 * signing out live. The dashboard shell opens WorkspaceAccountMenu instead, which falls back to this link.
 * A visitor (the demo workspace) gets a link to sign in. `shell`: the dashboard shell shows two initials.
 * The photo has no ring; hovering dims it.
 */
export function WorkspaceAccountLink({ shell = false }: { shell?: boolean }) {
  const { user, isSignedIn, isLoaded } = useUser();
  const initial = shell && user?.firstName && user.lastName ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase() : (user?.firstName ?? user?.primaryEmailAddress?.emailAddress ?? 'D').slice(0, 1).toUpperCase();
  const visitor = isLoaded && !isSignedIn;
  return <Button asChild variant="ghost" size="icon" className="workspace-account-link group/account rounded-full p-0">
    <Link href={visitor ? '/sign-in' : '/profile'} aria-label={visitor ? 'Sign in' : 'Settings'}><UserAvatar className="after:border-0 group-hover/account:opacity-75" fallback={initial} /></Link>
  </Button>;
}
