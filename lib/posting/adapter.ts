// The types the posting base (convex/posting*) and the Post Bridge client (lib/posting/postbridge) share.
import type { TikTokPostSettings } from './platform-limits';

export type PostingPlatform = 'instagram' | 'tiktok' | 'youtube';
export type PublishInput = { videoUrl: string; videoBytes: number; durationSeconds: number; width: number; height: number; title?: string; caption: string;
  /** What the user chose for a TikTok post: who can view it, and its interaction and disclosure settings. */
  tiktok?: TikTokPostSettings;
};
export type PublishResult =
  | { status: 'published'; platformPostId: string; url: string }
  | { status: 'processing'; platformJobId: string };
export type PublishCheck = PublishResult | { status: 'failed'; error: string; retryable: boolean };
/** A posting failure with a message the user can read. `retryable`: trying again later can work and cannot post twice. */
export class PostingError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly code?: string) { super(message); this.name = 'PostingError'; }
}
