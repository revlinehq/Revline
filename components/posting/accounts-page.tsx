'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAction, useConvexAuth, useMutation, useQuery } from 'convex/react';
import { CircleAlert, CircleCheck, Ellipsis } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { PostingPlatform } from '@/lib/posting/adapter';
import { capMessage } from '@/lib/posting/account-caps';
import { PLATFORM_NAMES } from '@/lib/posting/platform-names';
import { userError } from '@/lib/user-error';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AccountAvatar, PlatformIcon } from './account-avatar';
import '@/components/dashboard/dash-list.css';

/** Connected social accounts, a card per platform: connect, reconnect, disconnect, and "Coming soon" for platforms that are not live. */
/** A card per platform, still, while the platforms and accounts load. */
export function AccountsSkeleton() {
  return <div className="contents" role="status" aria-label="Loading your accounts">{Array.from({ length: 3 }, (_, index) => <Card key={index} variant="dash" className="dash-list">
    <div className="dash-list-head"><Skeleton className="size-[18px]" /><Skeleton className="h-4 w-24" /><div className="dash-list-actions"><Skeleton className="h-8 w-[84px] rounded-full" /></div></div>
    <div className="dash-list-row"><Skeleton className="h-4 w-44" /></div>
  </Card>)}</div>;
}

/**
 * Coming back from a platform's consent screen, and every time the page opens: the accounts are read again on the
 * server, then "Your TikTok account is connected" or the reason it was not. The address only says which message to
 * show (?status= and ?platform= from a connect link, ?connected= from Revline's own callback); which accounts exist
 * is never taken from it. Read in the browser, so the page itself stays static.
 */
function ConnectedNote({ onError }: { onError: (message: string) => void }) {
  const params = useSearchParams(), router = useRouter(), { isAuthenticated } = useConvexAuth(), sync = useAction(api.postingActions.syncAccounts);
  const status = params.get('status'), name = params.get('platform') ?? params.get('connected'), platform = name && name in PLATFORM_NAMES ? PLATFORM_NAMES[name as PostingPlatform] : null;
  const [note, setNote] = useState(status ? '' : platform ? `Your ${platform} account is connected.` : '');
  useEffect(() => {
    if (!isAuthenticated) return;
    let current = true;
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    sync(status ? { afterLink: true } : {}).then(async first => {
      // The platform can send the user back a moment before the account is listed, so an empty answer is asked for once more.
      const result = status === 'connected' && !first.connected.length && !first.overLimit ? await wait(4000).then(() => sync({ afterLink: true })) : first;
      if (!current || !status) return;
      if (status !== 'connected') onError(/cancel|denied/i.test(params.get('reason') ?? '') ? 'The connection was cancelled.' : 'This account was not connected. Please try again.');
      else if (result.overLimit) onError(capMessage(platform ?? 'social', result.cap));
      // What the server found decides the message, never the address alone.
      else if (result.connected.length) setNote(`Your ${platform ?? 'social'} account @${result.connected[0]} is connected.`);
      else onError('The account has not shown up yet. Reload this page in a moment.');
      // The message stays; the address goes back to the page's own, so a reload does not repeat it.
      router.replace('/accounts');
    }, reason => { if (current && status) onError(userError(reason, 'Your accounts could not be refreshed. Reload the page to try again.')); });
    return () => { current = false; };
  }, [isAuthenticated]);
  return note ? <p className="dash-column-note" role="status">{note}</p> : null;
}

export function AccountsPage() {
  const { isAuthenticated } = useConvexAuth();
  const platforms = useQuery(api.posting.platforms, isAuthenticated ? {} : 'skip');
  const accounts = useQuery(api.posting.accounts, isAuthenticated ? {} : 'skip');
  const options = useQuery(api.posting.options, isAuthenticated ? {} : 'skip');
  const startConnect = useAction(api.postingActions.startConnect), disconnect = useMutation(api.posting.disconnect);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState('');
  /** Connecting and reconnecting are the same round trip: the platform's consent screen, then back here. `accountId`: the account being reconnected. */
  async function connect(platform: PostingPlatform, accountId?: Id<'postingAccounts'>) {
    if (busy) return;
    setBusy(accountId ?? platform); setError('');
    // The page leaves for the platform's consent screen, so `busy` stays set on success.
    try { window.location.assign(await startConnect({ platform, ...(accountId ? { accountId } : {}) })); }
    catch (reason) { setError(userError(reason, 'Could not start connecting this account.')); setBusy(null); }
  }
  async function remove(accountId: Id<'postingAccounts'>) {
    if (busy) return;
    setBusy(accountId); setError('');
    try { await disconnect({ accountId }); }
    catch (reason) { setError(userError(reason, 'Could not disconnect this account.')); }
    finally { setBusy(null); }
  }
  return <main className="dash-content"><div className="dash-column">
    <h1 className="sr-only">Connected accounts</h1>
    <p className="dash-column-note">Revline posts your clips to the accounts you connect here.</p>
    <Suspense fallback={null}><ConnectedNote onError={setError} /></Suspense>
    {error && <p className="dash-error" role="alert">{error}</p>}
    {!platforms || !accounts ? <AccountsSkeleton /> : platforms.map(({ platform, live }) => {
      const name = PLATFORM_NAMES[platform], own = accounts.filter(account => account.platform === platform);
      // At the plan's cap for this platform: nothing more can be connected until one is disconnected.
      const full = !!options?.accountCap?.full.includes(platform);
      return <Card key={platform} variant="dash" role="region" aria-label={name} className="dash-list">
        <div className="dash-list-head">
          <PlatformIcon platform={platform} /><h2>{name}</h2>
          <span className="dash-list-meta">{!live ? 'Coming soon' : own.length ? `${own.length} ${own.length === 1 ? 'account' : 'accounts'}` : ''}</span>
          <div className="dash-list-actions"><Button variant="soft" size="sm" disabled={!live || !!busy || full} aria-label={`Connect a ${name} account`} onClick={() => void connect(platform)}>Connect</Button></div>
        </div>
        {own.map(account => <div key={account.id} className="dash-list-row">
          <AccountAvatar username={account.username} avatarUrl={account.avatarUrl} />
          <span className="dash-list-row-name">@{account.username}{account.status === 'needs_reconnect' && account.error && !/expired/i.test(account.error) && <small>{account.error}</small>}</span>
          {account.status === 'needs_reconnect'
            ? <span className="dash-list-state" data-attention=""><CircleAlert aria-hidden="true" />{/expired/i.test(account.error ?? 'expired') ? 'Sign-in expired' : 'Reconnect needed'}</span>
            : <span className="dash-list-state"><CircleCheck aria-hidden="true" />Connected</span>}
          {/* Signing in again renews this account in place: new tokens, name and picture. It is the main action only when the sign-in is broken. */}
          <Button variant={account.status === 'needs_reconnect' ? 'primary' : 'ghost'} size="sm" className="dash-reconnect" disabled={!live || !!busy} aria-label={`Reconnect @${account.username}`} onClick={() => void connect(platform, account.id)}>Reconnect</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="dash-more" aria-label={`More for @${account.username}`}><Ellipsis /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="dash-menu"><DropdownMenuItem disabled={!!busy} onSelect={() => void remove(account.id)}>Disconnect</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
        </div>)}
        {!own.length && <div className="dash-list-row dash-list-note">{live ? 'No accounts connected yet.' : `Posting to ${name} is not available yet.`}</div>}
        {live && full && <div className="dash-list-row dash-list-note" role="note">{capMessage(name, options!.accountCap!.perPlatform)}</div>}
      </Card>;
    })}
  </div></main>;
}
