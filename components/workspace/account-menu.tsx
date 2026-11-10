'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useClerk, useUser } from '@clerk/nextjs';
import { Database, History, LoaderCircle, LogOut, Palette, Send, Share2, UserRound } from 'lucide-react';
import { signOutToSignIn } from '@/lib/auth/sign-out';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/** `shell`: inside the dashboard shell the sidebar already links Posts and Connected accounts, and the profile page is called Settings. */
export function WorkspaceAccountMenu({ active, error, shell = false }: { active?: string; error?: string; shell?: boolean }) {
  const { user, isSignedIn, isLoaded } = useUser();
  const clerk = useClerk();
  const [accountError, setAccountError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const initial = shell && user?.firstName && user.lastName ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase() : (user?.firstName ?? user?.primaryEmailAddress?.emailAddress ?? 'D').slice(0, 1).toUpperCase();

  async function signOut() {
    setSigningOut(true); setAccountError('');
    try { await signOutToSignIn(clerk); }
    catch { setAccountError('Could not sign out. Please try again.'); setSigningOut(false); }
  }

  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="workspace-account-trigger rounded-full p-0" aria-label="Open account menu" disabled={!isLoaded}><Avatar>{user?.imageUrl && <AvatarImage src={user.imageUrl} alt="" />}<AvatarFallback>{initial}</AvatarFallback></Avatar></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" sideOffset={12} className="workspace-menu workspace-account-menu">
      <div className="workspace-account-identity"><Avatar size="lg">{user?.imageUrl && <AvatarImage src={user.imageUrl} alt="" />}<AvatarFallback>{initial}</AvatarFallback></Avatar><div><strong>{user?.fullName ?? (isSignedIn ? 'Your account' : 'Demo workspace')}</strong><span>{user?.primaryEmailAddress?.emailAddress ?? 'Sign in to save your work'}</span></div></div>
      <DropdownMenuSeparator className="workspace-menu-divider" />
      <DropdownMenuItem asChild className="workspace-menu-item"><Link href="/profile" aria-current={active === 'profile' ? 'page' : undefined}><UserRound size={16} />{shell ? 'Settings' : 'Profile'}</Link></DropdownMenuItem>
      <DropdownMenuItem asChild className="workspace-menu-item"><Link href="/storage" aria-current={active === 'storage' ? 'page' : undefined}><Database size={16} />Cloud storage</Link></DropdownMenuItem>
      <DropdownMenuItem asChild className="workspace-menu-item"><Link href="/brand-kits" aria-current={active === 'brand-kits' ? 'page' : undefined}><Palette size={16} />Brand kits</Link></DropdownMenuItem>
      {shell && <DropdownMenuItem asChild className="workspace-menu-item"><Link href="/chats" aria-current={active === 'chats' ? 'page' : undefined}><History size={16} />All projects</Link></DropdownMenuItem>}
      {!shell && <>
        <DropdownMenuItem asChild className="workspace-menu-item"><Link href="/accounts" aria-current={active === 'accounts' ? 'page' : undefined}><Share2 size={16} />Connected accounts</Link></DropdownMenuItem>
        <DropdownMenuItem asChild className="workspace-menu-item"><Link href="/posts" aria-current={active === 'posts' ? 'page' : undefined}><Send size={16} />Posts</Link></DropdownMenuItem>
      </>}
      <DropdownMenuSeparator className="workspace-menu-divider" />
      {isSignedIn ? <DropdownMenuItem className="workspace-menu-item" disabled={signingOut} onSelect={event => { event.preventDefault(); void signOut(); }}>{signingOut ? <LoaderCircle size={16} className="animate-spin" /> : <LogOut size={16} />}Sign out</DropdownMenuItem> : <DropdownMenuItem asChild className="workspace-menu-item"><Link href="/sign-in"><LogOut size={16} />Sign in</Link></DropdownMenuItem>}
      {(accountError || error) && <p className="workspace-inline-error" role="alert">{accountError || error}</p>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
