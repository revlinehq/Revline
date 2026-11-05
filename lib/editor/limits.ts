import { MAX_UPLOAD_PART_BYTES, MAX_UPLOAD_PARTS } from '../storage/upload-parts';

/** Export workload is bounded independently from the editable arrangement. */
export const MAX_EXPORT_SECONDS = 5 * 60;
export const MAX_EXPORT_LABEL = `${MAX_EXPORT_SECONDS / 60} minutes`;
/** Sources have no length or size cap of ours; only the transport's platform limits apply.
 * Parts start at 32 MiB and grow with the file: R2 multipart allows at most 10,000 parts, and
 * each part streams through the media Worker, whose request body limit is 100 MB. */
const UPLOAD_PART_BYTES = 32 * 1024 * 1024;
/** The part size for a file, or null when it is beyond those platform limits (about 930 GiB). */
export function uploadPartSize(size: number) {
  const mib = 1024 * 1024, needed = Math.ceil(size / MAX_UPLOAD_PARTS / mib) * mib;
  const partSize = Math.max(UPLOAD_PART_BYTES, needed);
  return partSize > MAX_UPLOAD_PART_BYTES ? null : partSize;
}
/** Imports above this size still work; they only take long enough to mention. */
export const LARGE_UPLOAD_BYTES = 2 * 1024 ** 3;
