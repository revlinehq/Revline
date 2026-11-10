import { ConvexError, v } from 'convex/values';
import { signMediaToken, verifyPartReceipt } from '../../lib/storage/media-tokens';
import { mediaConfig, storageControl } from './media_storage';
import { abortDirectUpload, completeDirectUpload, createDirectUpload, DIRECT_PART_LINK_MS, directPartUrl, directUploadsEnabled, resumableDirectParts, verifiedDirectParts } from './direct_upload';
import { MAX_UPLOAD_PARTS } from '../../lib/storage/upload-parts';

/** The parts a finished multipart upload reports back. */
export const partsValidator = v.array(v.object({ partNumber: v.number(), etag: v.string() }));

/** `direct` uploads live on storage's S3 API; the others go through the media Worker. */
type MultipartUpload = { key: string; uploadId: string; size: number; partSize: number; direct?: boolean };
const partCount = (size: number, partSize: number) => Math.ceil(size / partSize);
/** A part number this upload can have: 1 to its part count. */
export const validPartNumber = (partNumber: number, size: number, partSize: number) => Number.isInteger(partNumber) && partNumber >= 1 && partNumber <= partCount(size, partSize);
/** Every part, numbered 1 to n in order, each with an etag R2 can have issued. */
export const partsComplete = (parts: { partNumber: number; etag: string }[], size: number, partSize: number) => parts.length === partCount(size, partSize) && parts.every((part, i) => part.partNumber === i + 1 && !!part.etag && part.etag.length <= 256);

const PART_LINK_MS = 3600_000;
/** A one-hour URL that accepts exactly one part's bytes by PUT. */
export async function signedPartUrl(upload: MultipartUpload, partNumber: number) {
  if (upload.direct) return directPartUrl(upload, partNumber);
  const { url, secret } = mediaConfig();
  const size = Math.min(upload.partSize, upload.size - (partNumber - 1) * upload.partSize);
  const token = await signMediaToken(secret, { operation: 'part', key: upload.key, uploadId: upload.uploadId, partNumber, size, expires: Date.now() + PART_LINK_MS });
  return `${url}/part?token=${token}`;
}

/** The most part links one request may ask for. */
export const MAX_PART_LINKS = 100;
/** `ttlMs` is how long a link lasts from now; clients time it on their own clock. */
export const partLinksValidator = v.array(v.object({ partNumber: v.number(), url: v.string(), ttlMs: v.number() }));
/** Links for `count` consecutive parts from part `from`; a batch saves the browser a request per part. */
export async function signedPartUrls(upload: MultipartUpload, from: number, count: number) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_PART_LINKS || !validPartNumber(from, upload.size, upload.partSize)) return null;
  const last = Math.min(from + count - 1, partCount(upload.size, upload.partSize));
  return Promise.all(Array.from({ length: last - from + 1 }, async (_, index) => ({ partNumber: from + index, url: await signedPartUrl(upload, from + index), ttlMs: upload.direct ? DIRECT_PART_LINK_MS : PART_LINK_MS })));
}

/** What a browser remembers of a part it sent before the upload was interrupted. */
export const storedPartsValidator = v.array(v.object({ partNumber: v.number(), etag: v.string(), receipt: v.optional(v.string()) }));
/** The remembered parts storage really holds: each must carry the media Worker's receipt
 * for this upload, this part number and its exact size. The rest are sent again. */
export async function verifiedParts(upload: MultipartUpload, claimed: { partNumber: number; etag: string; receipt?: string }[]) {
  // Direct parts never pass the Worker, so there are no receipts: storage lists what it holds.
  if (upload.direct) return resumableDirectParts(upload);
  const { secret } = mediaConfig(), verified = new Map<number, { partNumber: number; etag: string }>();
  await Promise.all(claimed.slice(0, MAX_UPLOAD_PARTS).map(async ({ partNumber, etag, receipt }) => {
    if (!receipt || !etag || etag.length > 256 || !validPartNumber(partNumber, upload.size, upload.partSize)) return;
    const size = Math.min(upload.partSize, upload.size - (partNumber - 1) * upload.partSize);
    if (await verifyPartReceipt(secret, { key: upload.key, uploadId: upload.uploadId, partNumber, size, etag }, receipt)) verified.set(partNumber, { partNumber, etag });
  }));
  return [...verified.values()].sort((a, b) => a.partNumber - b.partNumber);
}

/** Opens a multipart upload. `direct` is honoured only when this deployment has direct uploads set up. */
export async function openMultipart(key: string, contentType: string, direct: boolean): Promise<{ uploadId: string; direct: boolean }> {
  if (direct && directUploadsEnabled()) return { uploadId: await createDirectUpload(key, contentType), direct: true };
  const created = await storageControl({ action: 'create', key, contentType });
  if (!created.uploadId) throw new ConvexError('Cloudflare did not open the upload');
  return { uploadId: created.uploadId, direct: false };
}
export async function abortMultipart(upload: { key: string; uploadId: string; direct?: boolean }) {
  if (upload.direct) await abortDirectUpload(upload); else await storageControl({ action: 'abort', key: upload.key, uploadId: upload.uploadId });
}
/** Assembles the parts and returns the stored size and type. A direct upload is first checked
 * against storage's own part list: every part present, each the exact size, etags as reported. */
export async function completeMultipart(upload: MultipartUpload, parts: { partNumber: number; etag: string }[]): Promise<{ size?: number; contentType?: string }> {
  if (!upload.direct) return storageControl({ action: 'complete', key: upload.key, uploadId: upload.uploadId, parts });
  const stored = await verifiedDirectParts(upload, parts);
  if (!stored) throw new ConvexError('Upload parts are incomplete');
  return completeDirectUpload(upload, stored);
}
