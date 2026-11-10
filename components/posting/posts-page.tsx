'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { ExternalLink, LoaderCircle, RotateCcw } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { MAX_ATTEMPTS } from '@/lib/posting/limits';
import { PLATFORM_NAMES } from '@/lib/posting/platform-names';
import { userError } from '@/lib/user-error';
import { WorkspaceNav } from '@/components/workspace/workspace-nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BatchLinks } from './batch-links';
import '@/components/workspace/workspace-pages.css';
import './posting.css';

type Post = FunctionReturnType<typeof api.posting.posts>[number];
type Group = 'queued' | 'scheduled' | 'published' | 'failed';
const groups: [Group | 'all', string][] = [['all', 'All'], ['queued', 'Queued'], ['scheduled', 'Scheduled'], ['published', 'Published'], ['failed', 'Failed']];
/** Queued covers everything in motion: waiting to go now, waiting to retry, posting, or processing on the platform. */
function groupOf(post: Post): Group {
  if (post.status === 'published' || post.status === 'failed') return post.status;
  return post.status === 'scheduled' && post.scheduledAt !== null && post.attempts === 0 ? 'scheduled' : 'queued';
}
function statusLine(post: Post) {
  if (post.status === 'published') return `Published ${post.publishedAt ? new Date(post.publishedAt).toLocaleString() : ''}${post.views !== null ? ` · ${post.views} views · ${post.likes ?? 0} likes · ${post.comments ?? 0} comments` : ''}`;
  if (post.status === 'posting') return 'Posting now…';
  if (post.status === 'processing') return 'The platform is processing the video.';
  if (post.status === 'scheduled') return post.attempts > 0 ? `Try ${post.attempts} of ${MAX_ATTEMPTS} did not go through. Trying again at ${new Date(post.dueAt).toLocaleTimeString()}.` : post.scheduledAt !== null ? `Scheduled for ${new Date(post.scheduledAt).toLocaleString()}` : 'Waiting to post.';
  return null;
}

/** Every post in one list: queued, scheduled, published, and failed with its reason and a retry. */
export function PostsPage() {
  const { isAuthenticated } = useConvexAuth();
  const posts = useQuery(api.posting.posts, isAuthenticated ? {} : 'skip');
  const retry = useMutation(api.posting.retry), cancel = useMutation(api.posting.cancel);
  const [group, setGroup] = useState<Group | 'all'>('all'), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState('');
  const [links, setLinks] = useState<Id<'postingBatches'> | null>(null);
  async function run(postId: Id<'postingPosts'>, action: typeof retry, fallback: string) {
    if (busy) return;
    setBusy(postId); setError('');
    try { await action({ postId }); }
    catch (reason) { setError(userError(reason, fallback)); }
    finally { setBusy(null); }
  }
  const shown = posts?.filter(post => group === 'all' || groupOf(post) === group) ?? [];
  return <div className="workspace-page workspace-profile-page">
    <WorkspaceNav title="Posts" active="posts" />
    <main className="workspace-profile-content">
      <div className="posting-heading-row"><div className="workspace-page-heading"><h1>Posts</h1><p>Everything Revline has posted or is about to post.</p></div><Button asChild variant="outline" size="md"><Link href="/accounts">Connected accounts</Link></Button></div>
      <Tabs className="posting-tabs" value={group} onValueChange={value => setGroup(value as Group | 'all')}><TabsList aria-label="Post status">{groups.map(([value, label]) => <TabsTrigger key={value} value={value}>{label}{posts && value !== 'all' ? ` ${posts.filter(post => groupOf(post) === value).length}` : ''}</TabsTrigger>)}</TabsList></Tabs>
      {error && <p className="workspace-inline-error" role="alert">{error}</p>}
      {!posts ? <div className="workspace-empty-state" role="status"><LoaderCircle size={20} className="animate-spin" /><p>Loading your posts…</p></div>
        : !shown.length ? <div className="workspace-empty-state"><h2>{group === 'all' ? 'No posts yet' : `Nothing ${group}`}</h2><p>Open a finished export in the editor and choose Post to send it to your accounts.</p></div>
        : <ul className="posting-list">{shown.map(post => <li key={post.id} className="posting-row posting-post-row">
          <div className="posting-row-text">
            <strong>{PLATFORM_NAMES[post.platform]} · @{post.username} · {post.exportLabel}</strong>
            {post.caption && <span className="posting-caption">{post.caption}</span>}
            {statusLine(post) && <span>{statusLine(post)}</span>}
            {post.error && <span className="posting-error">{post.error}</span>}
          </div>
          <div className="posting-post-actions">
            <Badge variant={post.status === 'failed' ? 'destructive' : 'outline'}>{groupOf(post) === 'queued' ? post.status === 'scheduled' ? 'Queued' : post.status === 'posting' ? 'Posting' : 'Processing' : groups.find(([value]) => value === groupOf(post))![1]}</Badge>
            {post.status === 'published' && post.url && <Button asChild variant="outline" size="md"><a href={post.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} />View</a></Button>}
            {post.campaignId && post.status === 'published' && <Button variant="outline" size="md" onClick={() => setLinks(post.batchId)}>Campaign links</Button>}
            {post.status === 'failed' && <Button variant="outline" size="md" disabled={!!busy} onClick={() => void run(post.id, retry, 'Could not retry this post.')}>{busy === post.id ? <LoaderCircle size={12} className="animate-spin" /> : <RotateCcw size={12} />}Retry</Button>}
            {post.status === 'scheduled' && <Button variant="outline" size="md" disabled={!!busy} onClick={() => void run(post.id, cancel, 'Could not cancel this post.')}>{busy === post.id && <LoaderCircle size={12} className="animate-spin" />}Cancel</Button>}
          </div>
        </li>)}</ul>}
    </main>
    <Dialog open={!!links} onOpenChange={open => { if (!open) setLinks(null); }}><DialogContent className="workspace-dialog posting-dialog"><DialogTitle>Campaign links</DialogTitle><DialogDescription>Content Rewards has no way to receive these automatically, so submit them there by hand.</DialogDescription>{links && <BatchLinks batchId={links} />}</DialogContent></Dialog>
  </div>;
}
