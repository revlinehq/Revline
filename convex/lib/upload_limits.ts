import { v } from 'convex/values';
import { signMediaToken } from '../../lib/storage/media-tokens';
import { mediaConfig } from './media_storage';

/** The parts a finished multipart upload reports back. */
export const partsValidator = v.array(v.object({ partNumber: v.number(), etag: v.string() }));

const partCount = (size: number, partSize: number) => Math.ceil(size / partSize);
/** A part number this upload can have: 1 to its part count. */
export const validPartNumber = (partNumber: number, size: number, partSize: number) => Number.isInteger(partNumber) && partNumber >= 1 && partNumber <= partCount(size, partSize);
/** Every part, numbered 1 to n in order, each with an etag R2 can have issued. */
export const partsComplete = (parts: { partNumber: number; etag: string }[], size: number, partSize: number) => parts.length === partCount(size, partSize) && parts.every((part, i) => part.partNumber === i + 1 && !!part.etag && part.etag.length <= 256);

/** A one-hour URL that accepts exactly one part's bytes by PUT. */
export async function signedPartUrl(upload: { key: string; uploadId: string; size: number; partSize: number }, partNumber: number) {
  const { url, secret } = mediaConfig();
  const size = Math.min(upload.partSize, upload.size - (partNumber - 1) * upload.partSize);
  const token = await signMediaToken(secret, { operation: 'part', key: upload.key, uploadId: upload.uploadId, partNumber, size, expires: Date.now() + 3600_000 });
  return `${url}/part?token=${token}`;
}
