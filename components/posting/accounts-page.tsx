'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
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
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AccountAvatar, PlatformIcon } from './account-avatar';
import '@/components/dashboard/dash-list.css';

/** A card per platform, still, while the platforms and accounts load. */
export function AccountsSkeleton() {
  return <div className="contents" role="status" aria-label="Loading your accounts">{Array.from({ length: 3 }, (_, index) => <Card key={index} variant="dash" className="dash-list">
    <div className="dash-list-head"><Skeleton className="size-[18px]" /><Skeleton className="h-4 w-24" /><div className="dash-list-actions"><Skeleton className="h-8 w-[84px] rounded-full" /></div></div>
    <div className="dash-list-row"><Skeleton className="h-4 w-44" /></div>
  </Card>)}</div>;
}

/** Connected social accounts, a card per platform: connect, reconnect, disconnect, and "Coming soon" for platforms that are not live. */
/** "Your TikTok account is connected", after the platform sends the user back with ?connected=. Read from the address in the browser, so the page itself stays static. */
function ConnectedNote() {
  const connected = useSearchParams().get('connected');
  return connected && connected in PLATFORM_NAMES ? <p className="dash-column-note" role="status">Your {PLATFORM_NAMES[connected as PostingPlatform]} account is connected.</p> : null;
}

export function AccountsPage() {
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
  return <div className="dash-page">
    <DashboardNavbar title="Connected accounts" />
    <main className="dash-content"><div className="dash-column">
      <h1 className="sr-only">Connected accounts</h1>
      <p className="dash-column-note">Revline posts your clips to the accounts you connect here.</p>
      {!error && <Suspense fallback={null}><ConnectedNote /></Suspense>}
      {error && <p className="dash-error" role="alert">{error}</p>}
      {!platforms || !accounts ? <AccountsSkeleton /> : platforms.map(({ platform, live }) => {
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
