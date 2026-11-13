'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { CircleAlert, Ellipsis, Loader, Plus } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { POSTING_NOT_SET_UP } from '@/lib/posting/limits';
import { PLATFORM_NAMES } from '@/lib/posting/platform-names';
import { userError } from '@/lib/user-error';
import { ProjectCover } from '@/components/workspace/project-cover';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AccountAvatar } from './account-avatar';
import { PostDialog } from './post-dialog';
import { postTime } from './post-time';
import { describe, type ClipPost, type Exporting, type Row } from './post-rows';
import { PostsCalendar, PostsHeader, PostsWeekSkeleton, mondayOf, type PostsView } from './posts-calendar';
import './posting.css';

const SHOWN_ACCOUNTS = 4;

/** A section of post rows, still, while the posts load. */
export function PostsSkeleton() {
  return <section className="posts-section" role="status" aria-label="Loading your posts">
    <div className="posts-section-head"><Skeleton className="h-4 w-24" /></div>
    <Card variant="dash" className="posts-list"><ul>{Array.from({ length: 4 }, (_, index) => <li key={index} className="posts-row">
      <span className="posts-thumb"><Skeleton className="h-[52px] w-[30px] rounded-[5px]" /></span>
      <span className="posts-caption"><Skeleton className="h-4 w-4/5" /></span>
      <span className="posts-accounts"><Skeleton className="size-8 rounded-full" /></span>
      <span className="posts-time"><Skeleton className="h-4 w-20" /></span>
      <span className="posts-status"><Skeleton className="h-4 w-24" /></span>
      <span className="posts-views"><Skeleton className="h-4 w-14" /></span>
      <span className="posts-actions" />
    </li>)}</ul></Card>
  </section>;
}

/** Every clip Revline is about to post or has posted: a week calendar with each post a card on its day, or the list of rows. */
export function PostsPage() {
  const { isAuthenticated } = useConvexAuth();
  const clips = useQuery(api.posting.clipPosts, isAuthenticated ? {} : 'skip');
  const exporting = useQuery(api.postExports.exporting, isAuthenticated ? {} : 'skip');
  const accounts = useQuery(api.posting.accounts, isAuthenticated ? {} : 'skip');
  const platforms = useQuery(api.posting.platforms, isAuthenticated ? {} : 'skip'), off = !!platforms && !platforms.some(entry => entry.live);
  const retry = useMutation(api.posting.retry), cancel = useMutation(api.posting.cancel), reschedule = useMutation(api.posting.reschedule), cancelExporting = useMutation(api.postExports.cancel);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState('');
  const [view, setView] = useState<PostsView>('week'), [week, setWeek] = useState<number | null>(null);
  // The week is the viewer's own, so it is set in the browser: a server in another time zone would render a different one.
  useEffect(() => setWeek(previous => previous ?? mondayOf(Date.now())), []);
  /** The Post dialog is open; `at` is the day "Post here" picked. */
  const [composing, setComposing] = useState<{ at?: number } | null>(null);
  async function run(row: Row, posts: ClipPost[], action: (post: ClipPost) => Promise<unknown>, fallback: string) {
    if (busy) return;
    setBusy(row.clip.batchId); setError('');
    const results = await Promise.allSettled(posts.map(action));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) setError(userError(failure.reason, fallback));
    setBusy(null);
  }
  const onRetry = (row: Row) => void run(row, row.retryable, post => retry({ postId: post.id }), 'Could not retry this post.');
  const onCancel = (row: Row) => void run(row, row.cancellable, post => cancel({ postId: post.id }), 'Could not cancel this post.');
  const onReschedule = (row: Row, scheduledAt: number) => void run(row, row.queued, post => reschedule({ postId: post.id, scheduledAt }), 'Could not move this post.');
  const onCancelExporting = (clip: Exporting) => { setError(''); void cancelExporting({ pendingId: clip.id }).catch(reason => setError(userError(reason, 'Could not cancel this post.'))); };
  const rows = clips?.map(clip => describe(clip, off)) ?? [];
  const sections = [
    { name: 'Scheduled', rows: rows.filter(row => row.scheduled).sort((a, b) => a.time - b.time) },
    { name: 'Posted', rows: rows.filter(row => !row.scheduled).sort((a, b) => b.time - a.time) },
  ].filter(section => section.rows.length);
  return <>
    <main className="dash-content posts-page" data-view={view}>
      <PostsHeader view={view} week={week} accounts={accounts} onView={setView} onWeek={setWeek} onNew={() => setComposing({})} />
      {off && <p className="dash-column-note" role="status">{POSTING_NOT_SET_UP}</p>}
      {error && <p className="dash-error" role="alert">{error}</p>}
      {view === 'week' ? !clips || !exporting || week === null ? <PostsWeekSkeleton />
        : <PostsCalendar week={week} rows={rows} exporting={exporting} busy={!!busy} onRetry={onRetry} onCancel={onCancel} onReschedule={onReschedule}
          onCancelExporting={onCancelExporting} onPostHere={at => setComposing({ at })} />
        : !clips ? <PostsSkeleton />
        : !sections.length && !exporting?.length ? <div className="dash-empty"><h2>No posts yet</h2><p>Clips you post or schedule show here.</p></div>
        : <>{!!exporting?.length && <section className="posts-section" aria-label="Exporting">
          <div className="posts-section-head"><h2>Exporting</h2><span>{exporting.length}</span></div>
          <Card variant="dash" className="posts-list"><ul>{exporting.map(clip => <ExportingRow key={clip.id} clip={clip} busy={!!busy} onCancel={() => onCancelExporting(clip)} />)}</ul></Card>
        </section>}{sections.map(section => <section key={section.name} className="posts-section" aria-label={section.name}>
          <div className="posts-section-head"><h2>{section.name}</h2><span>{section.rows.length}</span></div>
          <Card variant="dash" className="posts-list"><ul>{section.rows.map(row => <PostRow key={row.clip.batchId} row={row} busy={!!busy}
            onRetry={() => onRetry(row)} onCancel={() => onCancel(row)} />)}</ul></Card>
        </section>)}</>}
    </main>
    {composing && <PostDialog onPostsPage scheduleAt={composing.at} onClose={() => setComposing(null)} />}
  </>;
}

function PostRow({ row, busy, onRetry, onCancel }: { row: Row; busy: boolean; onRetry: () => void; onCancel: () => void }) {
  const { clip } = row, Icon = row.icon, text = clip.caption || clip.label;
  const extra = clip.posts.length - SHOWN_ACCOUNTS, live = row.published.filter(post => post.url);
  const menu = row.cancellable.length > 0 || live.length > 0 || row.reconnect;
  return <li className="posts-row">
    <span className="posts-thumb"><ProjectCover url={clip.coverUrl} kind={clip.coverKind} /></span>
    <span className="posts-caption" title={text}><span>{text}</span>{clip.byAssistant && <Badge variant="chip" className="posts-by">Assistant</Badge>}</span>
    <span className="posts-accounts" role="img" aria-label={clip.posts.map(post => `@${post.username} on ${PLATFORM_NAMES[post.platform]}`).join(', ')}>
      {clip.posts.slice(0, SHOWN_ACCOUNTS).map(post => <AccountAvatar key={post.id} username={post.username} avatarUrl={post.avatarUrl} platform={post.platform} />)}
      {extra > 0 && <span className="posts-accounts-more">+{extra}</span>}
    </span>
    <span className="posts-time">{postTime(row.time)}</span>
    <span className="posts-status"><span><Icon aria-hidden="true" />{row.status}</span>{row.reasons.map(text => <small key={text} title={text}>{text}</small>)}</span>
    <span className="posts-views">{row.views !== null && `${row.views.toLocaleString()} ${row.views === 1 ? 'view' : 'views'}`}</span>
    <span className="posts-actions">
      {row.retryable.length > 0 && <Button variant="soft" size="sm" disabled={busy} onClick={onRetry}>Retry</Button>}
      {menu && <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="dash-more" aria-label={`More for ${text}`}><Ellipsis /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="dash-menu">
          {row.cancellable.length > 0 && <DropdownMenuItem disabled={busy} onSelect={onCancel}>Cancel post</DropdownMenuItem>}
          {row.reconnect && <DropdownMenuItem asChild><Link href="/accounts">Reconnect account</Link></DropdownMenuItem>}
          {live.map(post => <DropdownMenuItem key={post.id} asChild><a href={post.url!} target="_blank" rel="noopener noreferrer"><span>View on {PLATFORM_NAMES[post.platform]} · @{post.username}</span></a></DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>}
    </span>
  </li>;
}

/** A clip whose export is still running (or failed): its posts do not exist yet, so the row says what it is waiting for. */
function ExportingRow({ clip, busy, onCancel }: { clip: Exporting; busy: boolean; onCancel: () => void }) {
  const text = clip.caption || clip.label, failed = clip.status === 'failed', Icon = failed ? CircleAlert : Loader;
  const extra = clip.accounts.length - SHOWN_ACCOUNTS;
  return <li className="posts-row">
    <span className="posts-thumb"><ProjectCover url={clip.coverUrl} kind={clip.coverKind} /></span>
    <span className="posts-caption" title={text}><span>{text}</span>{clip.byAssistant && <Badge variant="chip" className="posts-by">Assistant</Badge>}</span>
    <span className="posts-accounts" role="img" aria-label={clip.accounts.map(account => `@${account.username} on ${PLATFORM_NAMES[account.platform]}`).join(', ')}>
      {clip.accounts.slice(0, SHOWN_ACCOUNTS).map(account => <AccountAvatar key={account.id} username={account.username} avatarUrl={account.avatarUrl} platform={account.platform} />)}
      {extra > 0 && <span className="posts-accounts-more">+{extra}</span>}
    </span>
    <span className="posts-time">{postTime(clip.scheduledAt ?? clip.createdAt)}</span>
    <span className="posts-status"><span><Icon aria-hidden="true" />{failed ? 'Export failed' : clip.progress ? `Exporting ${Math.round(clip.progress)}%` : 'Exporting'}</span>
      <small title={clip.error ?? undefined}>{failed ? clip.error ?? 'Nothing was posted.' : clip.scheduledAt ? 'Posts at the scheduled time' : 'Posts when the export finishes'}</small></span>
    <span className="posts-views" />
    <span className="posts-actions">{!failed && <Button variant="soft" size="sm" disabled={busy} onClick={onCancel}>Cancel</Button>}</span>
  </li>;
}
