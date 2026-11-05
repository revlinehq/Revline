/** The largest multipart upload part a client may send. Each part streams through
 * the media Worker, whose request body limit is 100 MB; the Worker rejects larger parts. */
export const MAX_UPLOAD_PART_BYTES = 95 * 1024 * 1024;
/** R2 multipart uploads allow at most this many parts. */
export const MAX_UPLOAD_PARTS = 10_000;
