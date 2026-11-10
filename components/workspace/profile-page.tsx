'use client';
import { userError } from '@/lib/user-error';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useClerk, useUser } from '@clerk/nextjs';
import { signOutToSignIn } from '@/lib/auth/sign-out';
import { BillingSection, type CheckoutReturn } from './billing-section';
import { DevAiCosts } from './dev-ai-costs';
import { McpConnectorSection } from './mcp-connector-section';
import { DashboardNavbar } from '@/components/dashboard/dashboard-navbar';
import { SettingsBody, SettingsCard, SettingsRow } from '@/components/dashboard/settings-card';
import './workspace-pages.css';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

/** Settings (/profile): the plan, the profile, connected AI apps and signing out, as one column of cards. */
export function ProfilePage({ checkoutReturn }: { checkoutReturn?: CheckoutReturn }) {
  const { user, isLoaded, isSignedIn } = useUser();
  const clerk = useClerk();
  const fileInput = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [error, setError] = useState('');
  const name = user?.fullName ?? (isSignedIn ? 'Your account' : 'Demo workspace');
  const email = user?.primaryEmailAddress?.emailAddress;
  const initial = (user?.firstName ?? email ?? 'D').slice(0, 1).toUpperCase();
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
  return <div className="dash-page">
    <DashboardNavbar title="Settings" />
    <main className="dash-content"><div className="dash-column settings-page">
      <h1 className="sr-only">Settings</h1>
      {!isLoaded ? <div className="dash-empty" role="status"><p>Loading your account…</p></div> : <>
        <BillingSection checkoutReturn={checkoutReturn} />
        <SettingsCard title="Profile" action={isSignedIn && <Button variant="soft" size="sm" disabled={photoBusy} onClick={() => fileInput.current?.click()}>{photoBusy ? 'Updating…' : 'Change photo'}</Button>}>
          <SettingsRow label="Photo"><Avatar className="settings-avatar">{user?.imageUrl && <AvatarImage src={user.imageUrl} alt="Your profile photo" />}<AvatarFallback>{initial}</AvatarFallback></Avatar></SettingsRow>
          <SettingsRow label="Name">{name}</SettingsRow>
          <SettingsRow label="Email">{email ?? 'Sign in to see your email'}</SettingsRow>
          {photoError && <SettingsBody><p className="dash-error" role="alert">{photoError}</p></SettingsBody>}
          <input hidden type="file" accept="image/*" ref={fileInput} aria-label="Choose a profile photo" onChange={event => void changePhoto(event.target.files?.[0])} />
        </SettingsCard>
        <McpConnectorSection />
        <DevAiCosts />
        <Card variant="dash" className="dash-list"><div className="dash-list-row">
          <span className="dash-list-row-name dash-list-note">{email ? `Signed in as ${email}` : 'You are not signed in'}</span>
          {isSignedIn ? <Button variant="soft" size="sm" onClick={() => void signOut()} disabled={signingOut}>Sign out</Button> : <Button asChild variant="soft" size="sm"><Link href="/sign-in">Sign in</Link></Button>}
        </div></Card>
      </>}{error && <p className="dash-error" role="alert">{error}</p>}
    </div></main>
  </div>;
}
