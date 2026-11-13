import type { FunctionReturnType } from 'convex/server';
import type { api } from '@/convex/_generated/api';
import { PLATFORM_NAMES } from '@/lib/posting/platform-names';

export type Clip = FunctionReturnType<typeof api.posting.clipPosts>[number];
export type ClipPost = Clip['posts'][number];
export type Exporting = FunctionReturnType<typeof api.postExports.exporting>[number];

/** Still waiting for a time the user picked that has not come yet; nothing has been sent. */
export const waiting = (post: ClipPost, now: number) => post.status === 'scheduled' && post.attempts === 0 && post.scheduledAt !== null && post.scheduledAt > now;
/** Why a post failed: what the platform or Revline recorded, shortened to a few words when it is an expired sign-in. */
export function reason(post: ClipPost) {
  if (post.accountStatus === 'needs_reconnect' && (!post.error || /reconnect|expired/i.test(post.error))) return `${PLATFORM_NAMES[post.platform]} sign-in expired`;
  return post.error ?? `${PLATFORM_NAMES[post.platform]} did not accept this post`;
}

/** One clip as a calendar card: when it goes out or went out, which of its posts failed or wait, and what can be done about them. */
export function describe(clip: Clip, off: boolean) {
  const { posts } = clip, now = Date.now();
  // Posting is not set up on the server: a post that has not gone out stays queued and reads "Waiting"; the line above the list says why.
  const held = off && posts.some(post => post.status === 'scheduled' || post.status === 'processing');
  const failed = posts.filter(post => post.status === 'failed'), published = posts.filter(post => post.status === 'published'), queued = posts.filter(post => waiting(post, now));
  const scheduled = queued.length > 0;
  const time = scheduled ? Math.min(...queued.map(post => post.scheduledAt!)) : Math.max(...posts.map(post => post.publishedAt ?? post.scheduledAt ?? clip.createdAt));
  return {
    // A held post waits with the scheduled ones.
    clip, scheduled: scheduled || held, time, failed, published, queued,
    reasons: [...new Set(failed.map(reason))],
    retryable: failed.filter(post => post.accountStatus === 'connected'),
    reconnect: failed.some(post => post.accountStatus === 'needs_reconnect'),
    cancellable: posts.filter(post => post.status === 'scheduled'),
  };
}
export type Row = ReturnType<typeof describe>;
