'use client';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAction, useConvexAuth, useMutation, useQuery } from 'convex/react';
import { Plug } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { PostingPlatform } from '@/lib/posting/adapter';
import { atLimit, limitMessage } from '@/lib/posting/account-caps';
import { PLATFORM_NAMES, POSTING_PLATFORMS } from '@/lib/posting/platform-names';
import { userError } from '@/lib/user-error';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { PlatformIcon } from './account-avatar';
import { GroupPanes, PanesSkeleton, type AccountActions } from './account-groups';
import '@/components/dashboard/dash-list.css';

/** Connected social accounts: the groups and every account in two panes (account-groups.tsx), where accounts are also connected, reconnected and disconnected. While posting is not set up on the server, one line says so and the Connect and Reconnect buttons are off. */

/** The page's heading, with Connect account to its right. */
export function AccountsHeader({ children }: { children?: ReactNode }) {
  return <header className="accounts-head"><h1>Connected accounts</h1><div className="accounts-head-actions">{children}</div></header>;
}

/**
 * Coming back from a platform's consent screen, and every time the page opens: the accounts are read again on the
 * server, then "Your TikTok account is connected" or the reason it was not. The address only says which message to
 * show (?status= and ?platform= from the connect link); which accounts exist is never taken from it. Read in the
 * browser, so the page itself stays static.
 */
function ConnectedNote({ onError }: { onError: (message: string) => void }) {
  const params = useSearchParams(), router = useRouter(), { isAuthenticated } = useConvexAuth(), sync = useAction(api.postingActions.syncAccounts);
  const status = params.get('status'), name = params.get('platform'), platform = name && name in PLATFORM_NAMES ? PLATFORM_NAMES[name as PostingPlatform] : null;
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!isAuthenticated) return;
    let current = true;
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    sync(status ? { afterLink: true } : {}).then(async first => {
      // The platform can send the user back a moment before the account is listed, so an empty answer is asked for once more.
      const result = status === 'connected' && !first.connected.length && !first.overLimit ? await wait(4000).then(() => sync({ afterLink: true })) : first;
      if (!current || !status) return;
      if (status !== 'connected') onError(/cancel|denied/i.test(params.get('reason') ?? '') ? 'The connection was cancelled.' : 'This account was not connected. Please try again.');
      else if (result.overLimit) onError(limitMessage(result.cap));
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
  const allowance = useQuery(api.posting.accountAllowance, isAuthenticated ? {} : 'skip');
  // The limit counts every platform together. At or above it (after a downgrade) nothing new connects; what is connected stays and keeps posting.
  const full = !allowance || atLimit(allowance.connected, allowance.limit);
  const live = (platform: PostingPlatform) => !!platforms?.find(entry => entry.platform === platform)?.live;
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
  const canConnect = (platform: PostingPlatform) => live(platform) && !busy && !full;
  const actions: AccountActions = { live, canConnect, busy: !!busy, connect: (platform, accountId) => void connect(platform, accountId), disconnect: accountId => void remove(accountId) };
  return <main className="dash-content"><div className="dash-column">
    <AccountsHeader>
      {allowance && <span className="accounts-count">{allowance.limit === null ? allowance.connected : `${allowance.connected} of ${allowance.limit}`} connected</span>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button data-slot="button" variant="soft" disabled={!platforms?.some(entry => entry.live) || full || !!busy}><Plug />Connect account</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="dash-menu group-menu">{POSTING_PLATFORMS.map(platform => <DropdownMenuItem key={platform} disabled={!canConnect(platform)} onSelect={() => void connect(platform)}>
          <PlatformIcon platform={platform} /><span>{PLATFORM_NAMES[platform]}</span>
        </DropdownMenuItem>)}</DropdownMenuContent>
      </DropdownMenu>
    </AccountsHeader>
    {allowance && atLimit(allowance.connected, allowance.limit) && platforms?.some(entry => entry.live) && <p className="dash-column-note" role="note">{limitMessage(allowance.limit)}</p>}
    {platforms && !platforms.some(entry => entry.live) && <p className="dash-column-note" role="status">Posting isn’t set up yet.</p>}
    <Suspense fallback={null}><ConnectedNote onError={setError} /></Suspense>
    {error && <p className="dash-error" role="alert">{error}</p>}
    {!platforms || !accounts ? <PanesSkeleton /> : <GroupPanes accounts={accounts} actions={actions} />}
  </div></main>;
}
