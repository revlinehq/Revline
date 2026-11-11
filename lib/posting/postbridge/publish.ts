// Sending one export to one account through Post Bridge, and reading back what happened. Revline's own scheduler
// decides when this runs (convex/posting.ts), so every post is created to publish at once: Post Bridge never holds a
// scheduled post of ours, and cancelling or moving one stays a change to Revline's own row.
import { PostingError, type PostingPlatform, type PublishCheck, type PublishInput } from '../adapter';
import { REEL_LIMITS, VIDEO_LIMITS, titleFromCaption } from '../platform-limits';
import { shapeProblems, textProblems } from '../precheck';
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
 * What the platform would refuse about this file or its text, by its own documented limits: checked here, with the
 * file's size known, so a post that cannot go out is refused before anything is uploaded and with a reason the user can act on.
 */
function assertPostable(platform: PostingPlatform, input: PublishInput): void {
  const megabytes = (bytes: number) => Math.round(bytes / 1024 / 1024);
  const problem = shapeProblems(platform, input)[0] ?? textProblems(platform, input)[0]
    ?? (!(input.videoBytes > 0) ? 'The video file is empty or its size is unknown. Export the video again, then post it.' : undefined)
    ?? (platform === 'instagram' && input.videoBytes > REEL_LIMITS.maxBytes ? `Instagram Reels can be at most ${megabytes(REEL_LIMITS.maxBytes)} MB. Export at a lower quality and try again.` : undefined)
    ?? (platform === 'tiktok' && input.videoBytes > VIDEO_LIMITS.maxBytes ? 'The video is larger than 4 GB, the most TikTok accepts.' : undefined);
  if (problem) throw new PostingError(problem, false, 'not_postable');
}
// < and > are the only characters YouTube refuses in titles and descriptions. Captions use them ("<3", "->"), so the
// look-alike full-width forms go out instead of a failed post.
const withoutAngleBrackets = (text: string) => text.replace(/</g, '＜').replace(/>/g, '＞');

/**
 * `platform_configurations` for this post. Post Bridge takes a YouTube title and TikTok's interaction and disclosure
 * settings; it has no YouTube privacy (videos go out public), and TikTok is either public or "private" (Only me).
 */
export function configurations(platform: PostingPlatform, input: PublishInput): Record<string, unknown> {
  if (platform === 'youtube') {
    const title = withoutAngleBrackets(input.title?.replace(/\s+/g, ' ').trim() || titleFromCaption(input.caption)), caption = withoutAngleBrackets(input.caption);
    if (!title) throw new PostingError('YouTube needs a title. Add a title or a caption.', false, 'invalidTitle');
    return { youtube: { title, ...(caption !== input.caption ? { caption } : {}) } };
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

/**
 * A started post: Post Bridge's post id and the account it went to. The job id carries both, so the outcome is read
 * for the account the post was sent to, whatever that account's row points at later (a reconnect can give it a new id).
 */
export const jobId = (socialAccountId: number, postId: string) => `${socialAccountId}/${postId}`;
export function readJobId(job: string): { socialAccountId: number; postId: string } | null {
  const split = job.indexOf('/'), socialAccountId = Number(job.slice(0, split)), postId = job.slice(split + 1);
  return split > 0 && Number.isSafeInteger(socialAccountId) && postId ? { socialAccountId, postId } : null;
}

/** Start a post. Returns the job id `checkPublish` polls. */
export async function publish(apiKey: string, socialAccountId: number, platform: PostingPlatform, input: PublishInput): Promise<string> {
  // Checked and built first: a post that cannot go out is refused before any file moves.
  assertPostable(platform, input);
  const settings = configurations(platform, input);
  return jobId(socialAccountId, await createPost(apiKey, { caption: input.caption, socialAccountId, media: await media(apiKey, input), configurations: settings }));
}

/** Where a post lives when the platform gave no link for it: the account's own page. */
function profileUrl(platform: PostingPlatform, username: string) {
  const handle = encodeURIComponent(username);
  return platform === 'tiktok' ? `https://www.tiktok.com/@${handle}` : platform === 'instagram' ? `https://www.instagram.com/${handle}/` : `https://www.youtube.com/@${handle}`;
}

/** What happened to a post started by `publish`, for the account it was sent to only: another account's result on the same post is never read. */
export async function checkPublish(apiKey: string, job: string, account: { platform: PostingPlatform; username: string }): Promise<PublishCheck & { providerResultId?: string }> {
  const sent = readJobId(job);
  if (!sent) return { status: 'failed', error: 'Revline lost track of this post. Check the account first, then retry if the video is not there.', retryable: false };
  const { postId, socialAccountId } = sent, result = (await postResults(apiKey, postId)).find(row => row.socialAccountId === socialAccountId);
  if (result) {
    if (!result.success) return { status: 'failed', error: result.error || 'The platform refused this post.', retryable: false };
    return { status: 'published', platformPostId: result.platformPostId ?? result.id, url: result.url ?? profileUrl(account.platform, account.username), providerResultId: result.id };
  }
  const state = await getPostStatus(apiKey, postId);
  if (state === null) return { status: 'failed', error: 'The posting service no longer has this post. Check the account first, then retry if the video is not there.', retryable: false };
  if (state === 'failed') return { status: 'failed', error: 'The platform refused this post.', retryable: false };
  return { status: 'processing', platformJobId: job };
}
