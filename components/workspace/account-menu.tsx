'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { StorageMeter, UnfinishedUploads } from '@/components/library/storage-meter';
import { WorkspaceAccountLink } from './account-link';
import { UserAvatar } from './user-avatar';

/**
 * The avatar in the dashboard shell's top bar: opens the profile menu with who is signed in, storage against the
 * plan, and Settings (/profile), where the profile, the plan and signing out live. A visitor, or a session still
 * loading, gets the plain avatar link instead.
 */
export function WorkspaceAccountMenu() {
  const { user, isSignedIn } = useUser();
  const [open, setOpen] = useState(false), [review, setReview] = useState(false);
  if (!isSignedIn || !user) return <WorkspaceAccountLink shell />;
  const email = user.primaryEmailAddress?.emailAddress;
  const initial = user.firstName && user.lastName ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase() : (user.firstName ?? email ?? 'D').slice(0, 1).toUpperCase();
  const close = () => setOpen(false);
  return <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button variant="ghost" size="icon" className="workspace-account-link group/account rounded-full p-0" aria-label="Account and storage">
        <UserAvatar className="after:border-0 group-hover/account:opacity-75" fallback={initial} />
      </Button></PopoverTrigger>
      <PopoverContent align="end" className="account-menu">
        <div className="account-menu-who"><strong>{user.fullName ?? 'Your account'}</strong>{email && <small>{email}</small>}</div>
        <StorageMeter onNavigate={close} onReview={() => { close(); setReview(true); }} />
        <Button asChild variant="ghost" className="account-menu-item"><Link href="/profile" onClick={close}><Settings aria-hidden="true" />Settings</Link></Button>
      </PopoverContent>
    </Popover>
    {review && <UnfinishedUploads onClose={() => setReview(false)} />}
  </>;
}
