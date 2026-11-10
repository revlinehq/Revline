'use client';

import { useUser } from '@clerk/nextjs';
import { WorkspaceAccountMenu } from '@/components/workspace/account-menu';
import { LandingStartButton } from './start-button';
import { LandingButton } from './ui';

/** Visitors (and the first paint, before Clerk loads) get sign-in and the trial button; members get their workspace. */
export function LandingNavAuth() {
  const { isSignedIn } = useUser();

  if (isSignedIn) return <>
    <LandingButton href="/chats" variant="soft" size="sm">Workspace</LandingButton>
    <WorkspaceAccountMenu />
  </>;

  return <>
    <LandingButton href="/sign-in" variant="soft" size="sm">Sign in</LandingButton>
    <LandingStartButton label="Start free trial" size="sm" />
  </>;
}
