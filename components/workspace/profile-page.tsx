'use client';
import { userError } from '@/lib/user-error';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useClerk, useUser } from '@clerk/nextjs';
import { signOutToSignIn } from '@/lib/auth/sign-out';
import { LoaderCircle, LockKeyhole, LogOut } from 'lucide-react';
import { BillingSection, type CheckoutReturn } from './billing-section';
import { DevAiCosts } from './dev-ai-costs';
import { McpConnectorSection } from './mcp-connector-section';
import { MemorySection } from './memory-section';
import { WorkspaceNav } from './workspace-nav';
import './workspace-pages.css';
import { Button } from '@/components/ui/button';

export function ProfilePage({ checkoutReturn }: { checkoutReturn?: CheckoutReturn }) {
  const { user, isLoaded, isSignedIn } = useUser();
  const clerk = useClerk();
  const fileInput = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [error, setError] = useState('');
  const name = user?.fullName ?? (isSignedIn ? 'Your account' : 'Demo workspace');
  const initial = (user?.firstName ?? user?.primaryEmailAddress?.emailAddress ?? 'D').slice(0, 1).toUpperCase();
  async function changePhoto(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = '';
    if (!file || !user || photoBusy) return;
    setPhotoError('');
    if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) { setPhotoError('Choose an image smaller than 10 MB.'); return; }
    setPhotoBusy(true);
    try { await user.setProfileImage({ file }); }
    catch (reason) { setPhotoError(userError(reason, 'Could not update your photo.')); }
    finally { setPhotoBusy(false); }
  }
  async function signOut() {
    setSigningOut(true); setError('');
    try { await signOutToSignIn(clerk); }
    catch { setError('Could not sign out. Please try again.'); setSigningOut(false); }
  }
  return <div className="workspace-page workspace-profile-page">
    <WorkspaceNav title="Your profile" active="profile" />
    <main className="workspace-profile-content"><div className="workspace-page-heading"><h1>Your profile</h1><p>Your details and membership.</p></div>
      {!isLoaded ? <div className="workspace-empty-state" role="status"><LoaderCircle size={20} className="animate-spin" /><p>Loading your account…</p></div> : <>
        <section className="workspace-profile-section"><div className="workspace-section-label"><h2>Personal details</h2><p>How you appear in Revline.</p></div><div className="workspace-section-content"><div className="workspace-profile-photo"><span className="workspace-profile-avatar">{user?.imageUrl ? <img src={user.imageUrl} alt="Your profile" /> : initial}</span><div><strong>{name}</strong>{isSignedIn ? <Button variant="outline" size="md" className="workspace-photo-button" disabled={photoBusy} onClick={() => fileInput.current?.click()}>{photoBusy && <LoaderCircle size={12} className="animate-spin" />}{photoBusy ? 'Updating…' : 'Change photo'}</Button> : <Button asChild variant="outline" size="md"><Link className="workspace-photo-button" href="/sign-in">Sign in</Link></Button>}<input className="workspace-photo-input" type="file" accept="image/*" ref={fileInput} aria-label="Choose a profile photo" onChange={event => void changePhoto(event.target.files?.[0])} /></div></div>{photoError && <p className="workspace-inline-error" role="alert">{photoError}</p>}<div className="workspace-profile-email"><label htmlFor="profile-email">Email address</label><div><input id="profile-email" readOnly value={user?.primaryEmailAddress?.emailAddress ?? ''} placeholder="Sign in to view your email" /><LockKeyhole size={13} /></div><p>Your sign-in email.</p></div></div></section>
        <BillingSection checkoutReturn={checkoutReturn} />
        <McpConnectorSection />
        <MemorySection />
        <DevAiCosts />
        <section className="workspace-profile-section"><div className="workspace-section-label"><h2>Account</h2></div><div className="workspace-section-content workspace-account-actions">{isSignedIn ? <Button variant="outline" size="md" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? <LoaderCircle size={14} className="animate-spin" /> : <LogOut size={14} />}Sign out</Button> : <Button asChild variant="outline" size="md"><Link href="/sign-in">Sign in</Link></Button>}</div></section>
      </>}{error && <p className="workspace-inline-error" role="alert">{error}</p>}
    </main>
  </div>;
}
