'use client';

import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { SIGNED_IN_HOME_PATH } from '@/lib/workspace-routes';
import { WorkspaceAccountMenu } from '@/components/workspace/account-menu';
import { LandingStartButton } from './start-button';

/** Visitors (and the first paint, before Clerk loads) get Log in and Start free; members get their workspace. */
export function LandingNavAuth() {
  const { isSignedIn } = useUser();

  if (isSignedIn) return <div className="landing-nav-account">
    <Button asChild size="md" className="landing-button" data-variant="dark" data-size="sm">
      <Link href={SIGNED_IN_HOME_PATH}>Workspace</Link>
    </Button>
    <WorkspaceAccountMenu />
  </div>;

  return <>
    <a className="landing-nav-login" href="/sign-in">Log in</a>
    <LandingStartButton label="Start free" variant="dark" size="sm" />
  </>;
}
