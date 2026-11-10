// FILE_UPLOAD fallback: copies the video from Revline's storage to TikTok's upload URL in sequential chunks,
// holding one chunk in memory at a time. Used only when TikTok refuses PULL_FROM_URL because the media domain is
// not verified yet. Chunk rules: https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
import { PostingError } from '../../adapter';
import { send } from './api';

const MB = 1024 * 1024;
/** TikTok allows 5–64 MB per chunk. With 10 MB chunks the last one is under 20 MB, which a Convex action can hold. */
const CHUNK_BYTES = 10 * MB;
const CHUNK_TIMEOUT_MS = 120_000;
const CHUNK_ATTEMPTS = 3;
/** Stop before the action's 10-minute limit so the half-finished job can still be cancelled. */
const UPLOAD_BUDGET_MS = 8 * 60_000;
/** Larger files would not finish inside one Convex action (10 minutes); they need the verified pull-from-URL path. */
export const MAX_UPLOAD_BYTES = 1024 * MB;

export type ChunkPlan = { chunkSize: number; totalChunkCount: number };

/** TikTok's rule: count = floor(size / chunk), and the last chunk also carries the trailing bytes. A file under one chunk goes whole. */
export function chunkPlan(videoBytes: number): ChunkPlan {
  if (videoBytes <= CHUNK_BYTES) return { chunkSize: videoBytes, totalChunkCount: 1 };
  return { chunkSize: CHUNK_BYTES, totalChunkCount: Math.floor(videoBytes / CHUNK_BYTES) };
}

const UPLOAD_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

async function readChunk(videoUrl: string, first: number, last: number, videoBytes: number): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHUNK_TIMEOUT_MS);
  try {
    const response = await fetch(videoUrl, { headers: { Range: `bytes=${first}-${last}` }, signal: controller.signal });
    const whole = first === 0 && last === videoBytes - 1;
    // Decide from the status before reading: storage that ignores Range would otherwise hand over the whole file.
    if (response.status !== 206 && !(response.status === 200 && whole)) {
      await response.body?.cancel().catch(() => {});
      if (response.status >= 500 || response.status === 429) throw new PostingError('Revline\'s storage was briefly unavailable while reading the video. Try again.', true, 'video_read_failed');
      if (response.status === 200) throw new PostingError('Revline\'s storage did not return the requested part of the video, so it was not sent to TikTok.', false, 'video_range_unsupported');
      throw new PostingError(`The video could not be read from Revline's storage (HTTP ${response.status}). Its link may have expired.`, false, 'video_read_failed');
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== last - first + 1) throw new PostingError('The stored video is not the size Revline recorded for it, so it was not sent to TikTok.', false, 'video_size_mismatch');
    const type = (response.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
    return { bytes, contentType: UPLOAD_TYPES.includes(type) ? type : 'video/mp4' };
  } catch (error) {
    if (error instanceof PostingError) throw error;
    throw new PostingError('Could not read the video from Revline\'s storage. Try again.', true, 'video_read_failed');
  } finally {
    clearTimeout(timer);
  }
}

/** Sends every chunk in order. TikTok answers 206 for a chunk with more to come and 201 for the last one. */
export async function uploadFromUrl(uploadUrl: string, videoUrl: string, videoBytes: number, plan: ChunkPlan): Promise<void> {
  const deadline = Date.now() + UPLOAD_BUDGET_MS;
  for (let index = 0; index < plan.totalChunkCount; index++) {
    if (Date.now() > deadline) throw new PostingError('Copying the video to TikTok took too long. Verify the media domain with TikTok so it can fetch the video itself.', false, 'upload_too_slow');
    const first = index * plan.chunkSize;
    const last = index === plan.totalChunkCount - 1 ? videoBytes - 1 : first + plan.chunkSize - 1;
    const { bytes, contentType } = await readChunk(videoUrl, first, last, videoBytes);
    for (let attempt = 1; ; attempt++) {
      let status: number;
      try {
        ({ status } = await send(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType, 'Content-Range': `bytes ${first}-${last}/${videoBytes}` }, body: bytes }, 'upload the video', { timeoutMs: CHUNK_TIMEOUT_MS }));
      } catch (error) {
        if (attempt < CHUNK_ATTEMPTS) continue;
        throw error;
      }
      if (status === 201 || status === 206) break;
      // 416 on a re-send: TikTok already stored this chunk and only the answer was lost. If not, the next chunk fails.
      if (status === 416 && attempt > 1) break;
      if (status >= 500 && attempt < CHUNK_ATTEMPTS) continue;
      // 403: the upload URL expired (one hour). 404: TikTok dropped the upload task. 416: the byte range does not
      // match TikTok's progress. A fresh post starts a new upload.
      if (status >= 500 || status === 403 || status === 404 || status === 416) throw new PostingError('TikTok stopped accepting this upload before it finished. Try again.', true, `upload_http_${status}`);
      // 400: malformed headers or length.
      throw new PostingError(`TikTok rejected the video upload (HTTP ${status}).`, false, `upload_http_${status}`);
    }
  }
}
