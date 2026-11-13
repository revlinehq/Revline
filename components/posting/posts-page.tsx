'use client';
import { useEffect, useState } from 'react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { POSTING_NOT_SET_UP } from '@/lib/posting/limits';
import { userError } from '@/lib/user-error';
import { PostDialog } from './post-dialog';
import { describe, type ClipPost, type Exporting, type Row } from './post-rows';
import { PostsCalendar, PostsHeader, PostsWeekSkeleton, mondayOf } from './posts-calendar';
import './posting.css';

/** Every clip Revline is about to post or has posted: a week calendar with each post a card on its day. */
export function PostsPage() {
  const { isAuthenticated } = useConvexAuth();
  const clips = useQuery(api.posting.clipPosts, isAuthenticated ? {} : 'skip');
  const exporting = useQuery(api.postExports.exporting, isAuthenticated ? {} : 'skip');
  const accounts = useQuery(api.posting.accounts, isAuthenticated ? {} : 'skip');
  const platforms = useQuery(api.posting.platforms, isAuthenticated ? {} : 'skip'), off = !!platforms && !platforms.some(entry => entry.live);
  const retry = useMutation(api.posting.retry), cancel = useMutation(api.posting.cancel), reschedule = useMutation(api.posting.reschedule), cancelExporting = useMutation(api.postExports.cancel);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState('');
  const [week, setWeek] = useState<number | null>(null);
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
  return <>
    <main className="dash-content posts-page">
      <PostsHeader week={week} accounts={accounts} onWeek={setWeek} onNew={() => setComposing({})} />
      {off && <p className="dash-column-note" role="status">{POSTING_NOT_SET_UP}</p>}
      {error && <p className="dash-error" role="alert">{error}</p>}
      {!clips || !exporting || week === null ? <PostsWeekSkeleton />
        : <PostsCalendar week={week} rows={clips.map(clip => describe(clip, off))} exporting={exporting} busy={!!busy} onRetry={onRetry} onCancel={onCancel} onReschedule={onReschedule}
          onCancelExporting={onCancelExporting} onPostHere={at => setComposing({ at })} />}
    </main>
    {composing && <PostDialog onPostsPage scheduleAt={composing.at} onClose={() => setComposing(null)} />}
  </>;
}
