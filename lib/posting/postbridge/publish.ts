// Sending one export to one account through Post Bridge, and reading back what happened. Revline's own scheduler
// decides when this runs (convex/posting.ts), so every post is created to publish at once: Post Bridge never holds a
// scheduled post of ours, and cancelling or moving one stays a change to Revline's own row.
import { PostingError, type PostingPlatform, type PublishCheck, type PublishInput } from '../adapter';
import { titleFromCaption } from '../platforms/youtube/metadata';
import { createPost, createUpload, getPostStatus, postResults } from './client';

/** Post Bridge takes uploads up to this size on its signed upload address; a larger export is handed over as a link it downloads. */
export const UPLOAD_MAX_BYTES = 500 * 1024 * 1024;
/** An action gets 10 minutes. The upload may take five of them, which leaves room to hand the link over instead and create the post. */
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

/**
 * Copy the export from Revline's storage to Post Bridge's signed upload address. The file is piped from one request
 * into the other with its length stated, so it is never held in memory and never base64.
 */
async function upload(uploadUrl: string, input: PublishInput): Promise<void> {
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const file = await fetch(input.videoUrl, { signal: abort.signal });
    const bytes = Number(file.headers.get('content-length'));
    if (!file.ok || !file.body || !(bytes > 0)) throw new Error('The export could not be read from storage.');
    const sent = await fetch(uploadUrl, { method: 'PUT', signal: abort.signal, headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes) }, body: file.body, duplex: 'half' } as RequestInit);
    if (!sent.ok) throw new Error(`The upload was refused (${sent.status}).`);
  } finally { clearTimeout(timer); }
}

/** The uploaded file's media id, or the export's own link when it is too large to upload or the upload did not go through. Nothing has been posted at this point. */
async function media(apiKey: string, input: PublishInput): Promise<{ mediaId: string } | { url: string }> {
  if (input.videoBytes > 0 && input.videoBytes <= UPLOAD_MAX_BYTES) {
    try {
      const { mediaId, uploadUrl } = await createUpload(apiKey, { name: 'video.mp4', mimeType: 'video/mp4', bytes: input.videoBytes });
      await upload(uploadUrl, input);
      return { mediaId };
    } catch (error) {
      console.warn(`Posting: the export was not uploaded to the posting service; sending its link instead. ${error instanceof Error ? error.message : ''}`);
    }
  }
  return { url: input.videoUrl };
}

/**
 * `platform_configurations` for this post. Post Bridge takes a YouTube title and TikTok's interaction and disclosure
 * settings; it has no YouTube privacy (videos go out public), and TikTok is either public or "private" (Only me).
 */
export function configurations(platform: PostingPlatform, input: PublishInput): Record<string, unknown> {
  if (platform === 'youtube') {
    const title = input.title?.replace(/\s+/g, ' ').trim() || titleFromCaption(input.caption);
    if (!title) throw new PostingError('YouTube needs a title. Add a title or a caption.', false, 'invalidTitle');
    return { youtube: { title } };
  }
  if (platform === 'tiktok') {
    const choice = input.tiktok ?? {};
    return { tiktok: {
      // Without a choice the post is "Only me", as it always was.
      privacy_status: choice.privacyLevel === 'PUBLIC_TO_EVERYONE' ? 'public' : 'private',
      allow_comment: choice.allowComment === true, allow_duet: choice.allowDuet === true, allow_stitch: choice.allowStitch === true,
      disclose_your_brand: choice.yourBrand === true, disclose_branded_content: choice.brandedContent === true,
    } };
  }
  return {};
}

/** Start a post. Returns Post Bridge's post id, which `checkPublish` polls. */
export async function publish(apiKey: string, socialAccountId: number, platform: PostingPlatform, input: PublishInput): Promise<string> {
  // Built first: a post that cannot be described is refused before any file moves.
  const settings = configurations(platform, input);
  return createPost(apiKey, { caption: input.caption, socialAccountId, media: await media(apiKey, input), configurations: settings });
}

/** Where a post lives when the platform gave no link for it: the account's own page. */
function profileUrl(platform: PostingPlatform, username: string) {
  const handle = encodeURIComponent(username);
  return platform === 'tiktok' ? `https://www.tiktok.com/@${handle}` : platform === 'instagram' ? `https://www.instagram.com/${handle}/` : `https://www.youtube.com/@${handle}`;
}

/** What happened to a post started by `publish`, for this account only: another account's result on the same post is never read. */
export async function checkPublish(apiKey: string, postId: string, account: { socialAccountId: number; platform: PostingPlatform; username: string }): Promise<PublishCheck & { providerResultId?: string }> {
  const result = (await postResults(apiKey, postId)).find(row => row.socialAccountId === account.socialAccountId);
  if (result) {
    if (!result.success) return { status: 'failed', error: result.error || 'The platform refused this post.', retryable: false };
    return { status: 'published', platformPostId: result.platformPostId ?? result.id, url: result.url ?? profileUrl(account.platform, account.username), providerResultId: result.id };
  }
  const state = await getPostStatus(apiKey, postId);
  if (state === null) return { status: 'failed', error: 'The posting service no longer has this post. Check the account first, then retry if the video is not there.', retryable: false };
  if (state === 'failed') return { status: 'failed', error: 'The platform refused this post.', retryable: false };
  return { status: 'processing', platformJobId: postId };
}
