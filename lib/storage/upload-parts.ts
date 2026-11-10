/** The largest multipart upload part a client may send. Each part streams through
 * the media Worker, whose request body limit is 100 MB; the Worker rejects larger parts. */
export const MAX_UPLOAD_PART_BYTES = 95 * 1024 * 1024;
/** R2 multipart uploads allow at most this many parts. */
export const MAX_UPLOAD_PARTS = 10_000;

/** How many parts an upload of `size` bytes has. */
export const uploadPartCount = (size: number, partSize: number) => Math.ceil(size / partSize);
/** The exact byte length of one part: `partSize`, or what is left for the last part. */
export const uploadPartBytes = (size: number, partSize: number, partNumber: number) => Math.min(partSize, size - (partNumber - 1) * partSize);
