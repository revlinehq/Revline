// The contract between the posting base (convex/posting) and each platform adapter (lib/posting/platforms/<platform>).
// Adapters are plain fetch-based modules with no Node-only imports, so Convex actions can run them.
import type { TikTokPostSettings } from './platforms/tiktok/settings';
import type { YouTubePublishOptions } from './platforms/youtube/metadata';

export type PostingPlatform = 'instagram' | 'tiktok' | 'youtube';
export type PlatformCredentials = { clientId: string; clientSecret: string; redirectUri: string };
export type AccountTokens = { accessToken: string; refreshToken?: string; expiresAt?: number; scopes: string[] };
export type AccountProfile = { platformAccountId: string; username: string; displayName?: string; avatarUrl?: string };
export type PublishInput = { videoUrl: string; videoBytes: number; durationSeconds: number; width: number; height: number; title?: string; caption: string;
  /** What the user chose for this post on that platform (who can view it, and TikTok's interaction and disclosure settings). Instagram has no per-post privacy. */
  youtube?: YouTubePublishOptions; tiktok?: TikTokPostSettings;
};
export type PublishResult =
  | { status: 'published'; platformPostId: string; url: string }
  | { status: 'processing'; platformJobId: string };
export type PublishCheck = PublishResult | { status: 'failed'; error: string; retryable: boolean };
export type PostStats = { views: number; likes: number; comments: number; shares?: number; fetchedAt: number };
export class PostingError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly code?: string) { super(message); this.name = 'PostingError'; }
}
export interface PlatformAdapter {
  platform: PostingPlatform;
  /** Names of the server environment variables that hold this platform's app credentials. Both unset = "coming soon". */
  envKeys: { clientId: string; clientSecret: string };
  /** Scopes requested at connect: posting plus reading the account's own post stats. */
  scopes: string[];
  authUrl(credentials: PlatformCredentials, state: string): string;
  exchangeCode(credentials: PlatformCredentials, code: string): Promise<AccountTokens>;
  refresh(credentials: PlatformCredentials, tokens: AccountTokens): Promise<AccountTokens>;
  profile(tokens: AccountTokens): Promise<AccountProfile>;
  /** Starts a post. Throws PostingError; `retryable` tells the scheduler whether to try again. */
  publish(tokens: AccountTokens, input: PublishInput): Promise<PublishResult>;
  /** For platforms that process uploads asynchronously: poll a job started by publish. */
  checkPublish(tokens: AccountTokens, platformJobId: string): Promise<PublishCheck>;
  postStats(tokens: AccountTokens, platformPostId: string): Promise<PostStats>;
  /**
   * Ends Revline's access at the platform when the user disconnects the account. Resolves once the platform holds no
   * access for these tokens, or when it offers no way to end it; throws PostingError when the request did not go through.
   */
  revoke(credentials: PlatformCredentials, tokens: AccountTokens): Promise<void>;
}
