/** Export workload is bounded independently from the editable arrangement. */
export const MAX_EXPORT_SECONDS = 5 * 60;
export const MAX_EXPORT_LABEL = `${MAX_EXPORT_SECONDS / 60} minutes`;
/** Source import limits enforced when an upload opens (convex/r2.ts start). */
export const MAX_SOURCE_SECONDS = 24 * 60 * 60;
export const UPLOAD_PART_BYTES = 32 * 1024 * 1024;
export const MAX_UPLOAD_PARTS = 10_000;
/** Imports above this size still work; they only take long enough to mention. */
export const LARGE_UPLOAD_BYTES = 2 * 1024 ** 3;
