'use client';
import { useState } from 'react';
import { useAction, useConvexAuth, useMutation, useQuery } from 'convex/react';
import { CircleAlert, CircleCheck, Ellipsis } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { PostingPlatform } from '@/lib/posting/adapter';
import { PLATFORM_NAMES } from '@/lib/posting/platform-names';
import { userError } from '@/lib/user-error';
import { DashboardNavbar } from '@/components/dashboard/dashboard-navbar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AccountAvatar, PlatformIcon } from './account-avatar';
import '@/components/dashboard/dash-list.css';

/** Connected social accounts, a card per platform: connect, reconnect, disconnect, and "Coming soon" for platforms that are not live. */
export function AccountsPage({ connected }: { connected?: string }) {
  const { isAuthenticated } = useConvexAuth();
  const platforms = useQuery(api.posting.platforms, isAuthenticated ? {} : 'skip');
  const accounts = useQuery(api.posting.accounts, isAuthenticated ? {} : 'skip');
  const startConnect = useAction(api.postingActions.startConnect), disconnect = useMutation(api.posting.disconnect);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState('');
  /** Connecting and reconnecting are the same round trip: the platform's consent screen, then back to /accounts/callback. */
  async function connect(platform: PostingPlatform, key: string = platform) {
    if (busy) return;
    setBusy(key); setError('');
    // The page leaves for the platform's consent screen, so `busy` stays set on success.
    try { window.location.assign(await startConnect({ platform })); }
    catch (reason) { setError(userError(reason, 'Could not start connecting this account.')); setBusy(null); }
  }
  async function remove(accountId: Id<'postingAccounts'>) {
    if (busy) return;
    setBusy(accountId); setError('');
    try { await disconnect({ accountId }); }
    catch (reason) { setError(userError(reason, 'Could not disconnect this account.')); }
    finally { setBusy(null); }
  }
  const connectedName = connected && connected in PLATFORM_NAMES ? PLATFORM_NAMES[connected as PostingPlatform] : null;
  return <div className="dash-page">
    <DashboardNavbar title="Connected accounts" />
    <main className="dash-content"><div className="dash-column">
      <h1 className="sr-only">Connected accounts</h1>
      <p className="dash-column-note">Revline posts your clips to the accounts you connect here.</p>
      {connectedName && !error && <p className="dash-column-note" role="status">Your {connectedName} account is connected.</p>}
      {error && <p className="dash-error" role="alert">{error}</p>}
      {!platforms || !accounts ? <div className="dash-empty" role="status"><p>Loading your accounts…</p></div> : platforms.map(({ platform, live }) => {
        const name = PLATFORM_NAMES[platform], own = accounts.filter(account => account.platform === platform);
        return <Card key={platform} variant="dash" role="region" aria-label={name} className="dash-list">
          <div className="dash-list-head">
            <PlatformIcon platform={platform} /><h2>{name}</h2>
            <span className="dash-list-meta">{!live ? 'Coming soon' : own.length ? `${own.length} ${own.length === 1 ? 'account' : 'accounts'}` : ''}</span>
            <div className="dash-list-actions"><Button variant="soft" size="sm" disabled={!live || !!busy} aria-label={`Connect a ${name} account`} onClick={() => void connect(platform)}>Connect</Button></div>
          </div>
          {own.map(account => <div key={account.id} className="dash-list-row">
            <AccountAvatar username={account.username} avatarUrl={account.avatarUrl} />
            <span className="dash-list-row-name">@{account.username}{account.status === 'needs_reconnect' && account.error && !/expired/i.test(account.error) && <small>{account.error}</small>}</span>
            {account.status === 'needs_reconnect'
              ? <><span className="dash-list-state" data-attention=""><CircleAlert aria-hidden="true" />Sign-in expired</span><Button variant="soft" size="sm" disabled={!live || !!busy} onClick={() => void connect(platform, account.id)}>Reconnect</Button></>
              : <span className="dash-list-state"><CircleCheck aria-hidden="true" />Connected</span>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="dash-more" aria-label={`More for @${account.username}`}><Ellipsis /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="dash-menu"><DropdownMenuItem disabled={!!busy} onSelect={() => void remove(account.id)}>Disconnect</DropdownMenuItem></DropdownMenuContent>
            </DropdownMenu>
          </div>)}
          {!own.length && <div className="dash-list-row dash-list-note">{live ? 'No accounts connected yet.' : `Posting to ${name} is not available yet.`}</div>}
        </Card>;
      })}
    </div></main>
  </div>;
}
