'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useClerk, useUser } from '@clerk/nextjs';
import { LoaderCircle, LockKeyhole, LogOut, Moon, Settings2, Sun } from 'lucide-react';
import { BillingSection, type CheckoutReturn } from './billing-section';
import { WorkspaceNav } from './workspace-nav';
import { useWorkspaceTheme } from './theme-provider';
import './workspace-pages.css';

export function ProfilePage({ checkoutReturn }: { checkoutReturn?: CheckoutReturn }) {
  const { user, isLoaded, isSignedIn } = useUser();
  const clerk = useClerk();
  const { theme, setTheme } = useWorkspaceTheme();
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
    catch (reason) { setPhotoError(reason instanceof Error ? reason.message : 'Could not update your photo.'); }
    finally { setPhotoBusy(false); }
  }
  async function signOut() {
    setSigningOut(true); setError('');
    try { await clerk.signOut({ redirectUrl: '/' }); }
    catch { setError('Could not sign out. Please try again.'); setSigningOut(false); }
  }
  return <div className="workspace-page workspace-profile-page">
    <WorkspaceNav title="Your profile" active="profile" />
    <main className="workspace-profile-content"><div className="workspace-page-heading"><h1>Your profile</h1><p>Your details, membership, and account settings.</p></div>
      {!isLoaded ? <div className="workspace-empty-state" role="status"><LoaderCircle size={20} className="animate-spin" /><p>Loading your account…</p></div> : <>
        <section className="workspace-profile-section"><div className="workspace-section-label"><h2>Personal details</h2><p>How you appear in Revline.</p></div><div className="workspace-section-content"><div className="workspace-profile-photo"><span className="workspace-profile-avatar">{user?.imageUrl ? <img src={user.imageUrl} alt="Your profile" /> : initial}</span><div><strong>{name}</strong>{isSignedIn ? <button className="workspace-outline-button workspace-photo-button" disabled={photoBusy} onClick={() => fileInput.current?.click()}>{photoBusy && <LoaderCircle size={12} className="animate-spin" />}{photoBusy ? 'Updating…' : 'Change photo'}</button> : <Link className="workspace-outline-button workspace-photo-button" href="/sign-in">Sign in</Link>}<input className="workspace-photo-input" type="file" accept="image/*" ref={fileInput} aria-label="Choose a profile photo" onChange={event => void changePhoto(event.target.files?.[0])} /></div></div>{photoError && <p className="workspace-inline-error" role="alert">{photoError}</p>}<div className="workspace-profile-email"><label htmlFor="profile-email">Email address</label><div><input id="profile-email" readOnly value={user?.primaryEmailAddress?.emailAddress ?? ''} placeholder="Sign in to view your email" /><LockKeyhole size={13} /></div><p>Change your email in account settings.</p></div></div></section>
        <BillingSection checkoutReturn={checkoutReturn} />
        <section className="workspace-profile-section"><div className="workspace-section-label"><h2>Appearance</h2><p>Choose how Revline looks.</p></div><div className="workspace-section-content"><div className="workspace-appearance" role="group" aria-label="Appearance"><button aria-pressed={theme === 'light'} onClick={() => setTheme('light')}><Sun size={14} />Light</button><button aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}><Moon size={14} />Dark</button></div></div></section>
        <section className="workspace-profile-section"><div className="workspace-section-label"><h2>Account</h2><p>Sign-in and security.</p></div><div className="workspace-section-content workspace-account-actions">{isSignedIn ? <><button className="workspace-outline-button" onClick={() => clerk.openUserProfile()}><Settings2 size={14} />Account settings</button><button className="workspace-signout-button" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? <LoaderCircle size={14} className="animate-spin" /> : <LogOut size={14} />}Sign out</button></> : <Link href="/sign-in" className="workspace-outline-button"><Settings2 size={14} />Sign in to manage your account</Link>}</div></section>
      </>}{error && <p className="workspace-inline-error" role="alert">{error}</p>}
    </main>
  </div>;
}
