'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useAction, useConvexAuth, useMutation, useQuery } from 'convex/react';
import { LoaderCircle } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { PostingPlatform } from '@/lib/posting/adapter';
import { PLATFORM_NAMES } from '@/lib/posting/platform-names';
import { userError } from '@/lib/user-error';
import { WorkspaceNav } from '@/components/workspace/workspace-nav';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import '@/components/workspace/workspace-pages.css';
import './posting.css';

/** Connected social accounts per platform: connect, disconnect, and "Coming soon" for platforms that are not live. */
export function AccountsPage({ connected }: { connected?: string }) {
  const { isAuthenticated } = useConvexAuth();
  const platforms = useQuery(api.posting.platforms, isAuthenticated ? {} : 'skip');
  const accounts = useQuery(api.posting.accounts, isAuthenticated ? {} : 'skip');
  const startConnect = useAction(api.postingActions.startConnect), disconnect = useMutation(api.posting.disconnect);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState('');
  async function connect(platform: PostingPlatform) {
    if (busy) return;
    setBusy(platform); setError('');
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
  return <div className="workspace-page workspace-profile-page">
    <WorkspaceNav title="Connected accounts" active="accounts" />
    <main className="workspace-profile-content">
      <div className="posting-heading-row"><div className="workspace-page-heading"><h1>Connected accounts</h1><p>The social accounts Revline posts your exports to.</p></div><Button asChild variant="outline" size="md"><Link href="/posts">View posts</Link></Button></div>
      {connectedName && !error && <p className="posting-notice" role="status">Your {connectedName} account is connected.</p>}
      {error && <p className="workspace-inline-error" role="alert">{error}</p>}
      {!platforms || !accounts ? <div className="workspace-empty-state" role="status"><LoaderCircle size={20} className="animate-spin" /><p>Loading your accounts…</p></div> : platforms.map(({ platform, live }) => {
        const name = PLATFORM_NAMES[platform], own = accounts.filter(account => account.platform === platform);
        return <section key={platform} className="workspace-profile-section">
          <div className="workspace-section-label"><h2>{name}</h2><p>{live ? `${own.length} connected` : 'Coming soon'}</p></div>
          <div className="workspace-section-content">
            {own.length ? <ul className="posting-list">{own.map(account => <li key={account.id} className="posting-row">
              <Avatar>{account.avatarUrl && <AvatarImage src={account.avatarUrl} alt="" />}<AvatarFallback>{account.username.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
              <div className="posting-row-text"><strong>@{account.username}</strong>{account.status === 'needs_reconnect' ? <span className="posting-error">{account.error ?? 'The connection expired.'} Connect it again to keep posting.</span> : account.displayName && <span>{account.displayName}</span>}</div>
              {account.status === 'needs_reconnect' && <Badge variant="destructive">Reconnect</Badge>}
              <Button variant="outline" size="md" disabled={!!busy} onClick={() => void remove(account.id)}>{busy === account.id && <LoaderCircle size={12} className="animate-spin" />}Disconnect</Button>
            </li>)}</ul> : <p className="posting-empty">{live ? `No ${name} accounts connected yet.` : `${name} posting is not available yet.`}</p>}
            <div className="posting-section-action"><Button variant="outline" size="md" disabled={!live || !!busy} onClick={() => void connect(platform)}>{busy === platform && <LoaderCircle size={12} className="animate-spin" />}{live ? `Connect ${own.length ? 'another ' : 'a '}${name} account` : 'Coming soon'}</Button></div>
          </div>
        </section>;
      })}
    </main>
  </div>;
}
