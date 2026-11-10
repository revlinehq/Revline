import { PostingError, type AccountTokens } from '../../adapter';
import { errorFromResponse } from './errors';
import { bearer, exchange, readCapped, sleep } from './http';
import type { VideoMetadata } from './metadata';

// Resumable upload: the file is copied from Revline's storage to YouTube one chunk at a time, so memory use
// is one chunk whatever the file size, and an upload that outlives one action continues in the next.
// https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
const STORAGE = "Revline's video storage";

/** YouTube requires chunks in multiples of 256 KiB. 8 MiB keeps a Convex action (64 MiB) far from its memory limit. */
export const CHUNK_BYTES = 32 * 256 * 1024;
/**
 * No new chunk starts after this much of one publish/checkPublish call. The chunk in flight can add two
 * request timeouts (read + write, 2 × 90 s), so a call ends within about 7 minutes of the 10 an action gets.
 */
export const UPLOAD_BUDGET_MS = 240_000;
/** A job older than this is reported as failed instead of "still processing". */
export const JOB_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FILE_BYTES = 256 * 1024 ** 3;

export type UploadJob = { v: 1; kind: 'upload'; session: string; source: string; bytes: number; short: boolean; at: number };
export type VideoJob = { v: 1; kind: 'video'; id: string; short: boolean; at: number };
export type Job = UploadJob | VideoJob;

/** The job id is the whole resume state. It holds the upload session address and the file link: keep it server-side. */
export function encodeJob(job: Job): string {
  return JSON.stringify(job);
}

// The access token is sent to the session address, so it must be Google's.
function isGoogleUploadAddress(session: string): boolean {
  try {
    const url = new URL(session);
    return url.protocol === 'https:' && (url.hostname === 'googleapis.com' || url.hostname.endsWith('.googleapis.com'));
  } catch {
    return false;
  }
}

export function decodeJob(platformJobId: string): Job {
  try {
    const job = JSON.parse(platformJobId) as Record<string, unknown>;
    const short = job.short === true;
    const at = typeof job.at === 'number' ? job.at : 0;
    if (job.v === 1 && job.kind === 'video' && typeof job.id === 'string') return { v: 1, kind: 'video', id: job.id, short, at };
    if (
      job.v === 1 && job.kind === 'upload' && typeof job.session === 'string' && isGoogleUploadAddress(job.session)
      && typeof job.source === 'string' && typeof job.bytes === 'number'
    ) {
      return { v: 1, kind: 'upload', session: job.session, source: job.source, bytes: job.bytes, short, at };
    }
  } catch { /* fall through */ }
  throw new PostingError('Revline lost track of this YouTube upload. Post the video again.', false, 'invalidJob');
}

type Chunk = { data: ArrayBuffer; total: number; contentType: string | null };

/** Reads bytes [start, end] of the source file with an HTTP Range request (fewer only when the file ends sooner). */
export function readChunk(source: string, start: number, end: number): Promise<Chunk> {
  return exchange(source, { headers: { Range: `bytes=${start}-${end}` } }, STORAGE, async (response) => {
    const contentType = response.headers.get('Content-Type');

    if (response.status === 206) {
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '');
      const total = range ? Number(range[3]) : 0;
      // A server may answer with less than was asked for. A short chunk that is not the end of the file
      // would break YouTube's chunk-size rule, so treat it as a failed read.
      if (!range || Number(range[1]) !== start || Number(range[2]) !== Math.min(end, total - 1)) {
        throw new PostingError('The video storage returned a different part of the file than was asked for. Revline will try again.', true, 'sourceRange');
      }
      const data = await response.arrayBuffer();
      if (data.byteLength !== Number(range[2]) - start + 1) {
        throw new PostingError('The video file arrived incomplete from storage. Revline will try again.', true, 'sourceRange');
      }
      return { data, total, contentType };
    }

    if (response.status === 200) {
      // The server ignored Range and is sending the whole file. That only works when the whole file fits in the
      // chunk that was asked for.
      const data = start === 0 ? await readCapped(response, end + 1) : null;
      if (!data) {
        throw new PostingError('The video storage does not support reading a file in parts, which large uploads to YouTube need.', false, 'sourceNoRange');
      }
      return { data, total: data.byteLength, contentType };
    }

    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      throw new PostingError('Could not read the video file from storage. Revline will try again.', true, 'sourceUnavailable');
    }
    // 401/403/404/410: the link expired or the file is gone. 416: the file is shorter than expected.
    throw new PostingError('The video file is no longer available to upload. Export it again and repost.', false, 'sourceGone');
  });
}

/** Opens an upload session and returns its address. This is the call that uses one unit of upload quota. */
export function startSession(
  tokens: AccountTokens,
  metadata: VideoMetadata,
  totalBytes: number,
  contentType: string | null,
  notifySubscribers: boolean | undefined,
): Promise<string> {
  if (totalBytes <= 0) throw new PostingError('The video file is empty.', false, 'emptyFile');
  if (totalBytes > MAX_FILE_BYTES) throw new PostingError('The video file is larger than the 256 GB YouTube accepts.', false, 'fileTooLarge');
  const params = new URLSearchParams({ uploadType: 'resumable', part: 'snippet,status' });
  if (notifySubscribers !== undefined) params.set('notifySubscribers', String(notifySubscribers));
  return exchange(`${UPLOAD_URL}?${params}`, {
    method: 'POST',
    headers: {
      ...bearer(tokens),
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(totalBytes),
      'X-Upload-Content-Type': contentType?.startsWith('video/') ? contentType : 'application/octet-stream',
    },
    body: JSON.stringify(metadata),
  }, 'YouTube', async (response) => {
    if (!response.ok) throw await errorFromResponse(response);
    const session = response.headers.get('Location');
    if (!session || !isGoogleUploadAddress(session)) {
      throw new PostingError('YouTube did not open an upload session. Revline will try again.', true, 'noSession');
    }
    return session;
  });
}

type SessionState = { done: true; videoId: string } | { done: false; next: number };

// 308 "Resume Incomplete" reports what YouTube has stored so far; 200/201 carry the finished video.
async function sessionState(response: Response): Promise<SessionState> {
  if (response.status === 308) {
    const range = /^bytes=0-(\d+)$/.exec(response.headers.get('Range') ?? '');
    return { done: false, next: range ? Number(range[1]) + 1 : 0 };
  }
  if (response.status === 200 || response.status === 201) {
    // If this body is lost the video still exists: asking the session again returns it, so this is retryable.
    const video = (await response.json()) as { id?: string } | null;
    if (!video?.id) throw new PostingError('YouTube finished the upload but did not say which video it made. Revline will ask again.', true, 'noVideoId');
    return { done: true, videoId: video.id };
  }
  if (response.status === 404 || response.status === 410) {
    throw new PostingError('The YouTube upload session expired before the upload finished. Revline will start it again.', true, 'uploadSessionExpired');
  }
  throw await errorFromResponse(response);
}

/** Asks YouTube how many bytes of this session it has. */
function queryState(tokens: AccountTokens, job: UploadJob): Promise<SessionState> {
  return exchange(job.session, { method: 'PUT', headers: { ...bearer(tokens), 'Content-Range': `bytes */${job.bytes}` } }, 'YouTube', sessionState);
}

function putChunk(tokens: AccountTokens, job: UploadJob, data: ArrayBuffer, start: number): Promise<SessionState> {
  return exchange(job.session, {
    method: 'PUT',
    headers: { ...bearer(tokens), 'Content-Range': `bytes ${start}-${start + data.byteLength - 1}/${job.bytes}` },
    body: data,
  }, 'YouTube', sessionState);
}

export type UploadOutcome = { done: true; videoId: string } | { done: false };

// Errors that trying again inside the same call cannot fix: the session is gone, or the access token must be
// refreshed by the base first.
function needsCaller(error: PostingError): boolean {
  return !error.retryable || error.code === 'uploadSessionExpired' || error.code === 'unauthorized';
}

/**
 * Sends chunks until the file is complete or the time budget runs out. Throws PostingError; a retryable one
 * (other than `uploadSessionExpired`) leaves the session intact, so the caller can resume it later.
 *
 * `first` is the chunk at offset 0 when the caller has already read it; `known` is the resume offset when the
 * caller already knows it (0 for a session that was just opened).
 */
export async function runUpload(
  tokens: AccountTokens,
  job: UploadJob,
  deadline: number,
  known?: number,
  first?: ArrayBuffer,
): Promise<UploadOutcome> {
  let state: SessionState = known === undefined ? await queryState(tokens, job) : { done: false, next: known };
  let failures = 0;
  let stalls = 0;

  while (!state.done) {
    if (Date.now() >= deadline) return { done: false };
    const start = state.next;
    try {
      if (start >= job.bytes) {
        // Every byte is stored but the session has not produced the video yet: ask once more, then leave it
        // for the next call.
        state = await queryState(tokens, job);
        if (!state.done) return { done: false };
        break;
      }
      const end = Math.min(start + CHUNK_BYTES, job.bytes) - 1;
      const data = start === 0 && first ? first : (await readChunk(job.source, start, end)).data;
      first = undefined;
      state = await putChunk(tokens, job, data, start);
      failures = 0;
    } catch (error) {
      if (!(error instanceof PostingError) || needsCaller(error)) throw error;
      if (++failures >= 3 || Date.now() >= deadline) throw error;
      await sleep(1000 * 2 ** failures);
      // After an interruption, never assume how much arrived: ask.
      state = await queryState(tokens, job);
      continue;
    }
    if (!state.done && state.next <= start && ++stalls >= 3) {
      throw new PostingError('YouTube stopped accepting the upload. Revline will try again.', true, 'uploadStalled');
    }
  }
  return { done: true, videoId: state.videoId };
}
