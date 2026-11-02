'use client';

import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkspaceAccountMenu } from '@/components/workspace/account-menu';
import { LandingStartButton } from './start-button';

export function LandingNavAuth() {
  const { isLoaded, isSignedIn } = useUser();

  if (!isLoaded) return <Skeleton className="h-8 w-36" aria-hidden="true" />;

  if (isSignedIn) return <div className="landing-nav-account">
    <Button asChild size="md" className="landing-button" data-variant="dark" data-size="sm">
      <Link href="/chats">Workspace</Link>
    </Button>
    <WorkspaceAccountMenu />
  </div>;

  return <>
    <a className="landing-nav-login" href="/sign-in">Log in</a>
    <LandingStartButton label="Start free" variant="dark" size="sm" />
  </>;
}
