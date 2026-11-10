import { v } from 'convex/values';
import { signMediaToken, verifyPartReceipt } from '../../lib/storage/media-tokens';
import { mediaConfig } from './media_storage';
import { MAX_UPLOAD_PARTS } from '../../lib/storage/upload-parts';

/** The parts a finished multipart upload reports back. */
export const partsValidator = v.array(v.object({ partNumber: v.number(), etag: v.string() }));

const partCount = (size: number, partSize: number) => Math.ceil(size / partSize);
/** A part number this upload can have: 1 to its part count. */
export const validPartNumber = (partNumber: number, size: number, partSize: number) => Number.isInteger(partNumber) && partNumber >= 1 && partNumber <= partCount(size, partSize);
/** Every part, numbered 1 to n in order, each with an etag R2 can have issued. */
export const partsComplete = (parts: { partNumber: number; etag: string }[], size: number, partSize: number) => parts.length === partCount(size, partSize) && parts.every((part, i) => part.partNumber === i + 1 && !!part.etag && part.etag.length <= 256);

const PART_LINK_MS = 3600_000;
/** A one-hour URL that accepts exactly one part's bytes by PUT. */
export async function signedPartUrl(upload: { key: string; uploadId: string; size: number; partSize: number }, partNumber: number) {
  const { url, secret } = mediaConfig();
  const size = Math.min(upload.partSize, upload.size - (partNumber - 1) * upload.partSize);
  const token = await signMediaToken(secret, { operation: 'part', key: upload.key, uploadId: upload.uploadId, partNumber, size, expires: Date.now() + PART_LINK_MS });
  return `${url}/part?token=${token}`;
}

/** The most part links one request may ask for. */
export const MAX_PART_LINKS = 100;
/** `ttlMs` is how long a link lasts from now; clients time it on their own clock. */
export const partLinksValidator = v.array(v.object({ partNumber: v.number(), url: v.string(), ttlMs: v.number() }));
type MultipartUpload = { key: string; uploadId: string; size: number; partSize: number };
/** Links for `count` consecutive parts from part `from`; a batch saves the browser a request per part. */
export async function signedPartUrls(upload: MultipartUpload, from: number, count: number) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_PART_LINKS || !validPartNumber(from, upload.size, upload.partSize)) return null;
  const last = Math.min(from + count - 1, partCount(upload.size, upload.partSize));
  return Promise.all(Array.from({ length: last - from + 1 }, async (_, index) => ({ partNumber: from + index, url: await signedPartUrl(upload, from + index), ttlMs: PART_LINK_MS })));
}

/** What a browser remembers of a part it sent before the upload was interrupted. */
export const storedPartsValidator = v.array(v.object({ partNumber: v.number(), etag: v.string(), receipt: v.optional(v.string()) }));
/** The remembered parts storage really holds: each must carry the media Worker's receipt
 * for this upload, this part number and its exact size. The rest are sent again. */
export async function verifiedParts(upload: MultipartUpload, claimed: { partNumber: number; etag: string; receipt?: string }[]) {
  const { secret } = mediaConfig(), verified = new Map<number, { partNumber: number; etag: string }>();
  await Promise.all(claimed.slice(0, MAX_UPLOAD_PARTS).map(async ({ partNumber, etag, receipt }) => {
    if (!receipt || !etag || etag.length > 256 || !validPartNumber(partNumber, upload.size, upload.partSize)) return;
    const size = Math.min(upload.partSize, upload.size - (partNumber - 1) * upload.partSize);
    if (await verifyPartReceipt(secret, { key: upload.key, uploadId: upload.uploadId, partNumber, size, etag }, receipt)) verified.set(partNumber, { partNumber, etag });
  }));
  return [...verified.values()].sort((a, b) => a.partNumber - b.partNumber);
}
