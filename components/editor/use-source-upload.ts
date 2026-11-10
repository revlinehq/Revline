'use client';

import { useCallback } from 'react';
import { useAction, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { SourceUploadTransport } from '@/lib/editor/upload-source';
import { backendLacks, startDirect } from '@/lib/editor/upload-resume';
import { uploadMediaThumbnail } from '@/lib/editor/upload-thumbnail';

/** The R2 multipart upload and poster thumbnail calls every source upload uses. */
export function useSourceUpload() {
  const startUpload = useAction(api.r2.start);
  const partUrl = useAction(api.r2.partUrl), partUrls = useAction(api.r2.partUrls), resumeUpload = useAction(api.r2.resume);
  const finishUpload = useAction(api.r2.complete);
  const abortUpload = useAction(api.r2.abort);
  const thumbnailUpload = useMutation(api.assets.generateUploadUrl);
  const attachThumbnail = useMutation(api.assets.attachThumbnail);
  const saveThumbnail = useCallback((projectId: Id<'projects'>, assetId: Id<'assets'>, image: Blob) => uploadMediaThumbnail(image, {
    uploadUrl: () => thumbnailUpload({ projectId }), attach: storageId => attachThumbnail({ assetId, storageId }),
  }), [thumbnailUpload, attachThumbnail]);
  const transport = useCallback((projectId: Id<'projects'>, file: File, extra: Pick<SourceUploadTransport, 'onThumbnail'> = {}): SourceUploadTransport => ({
    start: metadata => startDirect(options => startUpload({ projectId, fileName: file.name, contentType: file.type, size: file.size, ...metadata, ...options })),
    scope: `project:${projectId}`,
    // A backend that does not have the batched calls yet signs one part at a time and restarts interrupted uploads.
    partUrls: (uploadId, from, count) => partUrls({ uploadId, from, count }).catch(async error => { if (!backendLacks(error)) throw error; return [{ partNumber: from, url: await partUrl({ uploadId, partNumber: from }), ttlMs: 3600_000 }]; }),
    resume: (uploadId, parts) => resumeUpload({ uploadId, projectId, size: file.size, parts }).catch(error => { if (!backendLacks(error)) throw error; return undefined; }),
    complete: (uploadId, parts) => finishUpload({ uploadId, parts }),
    abort: uploadId => abortUpload({ uploadId }),
    ...extra,
    saveThumbnail: (assetId, image) => saveThumbnail(projectId, assetId, image),
  }), [startUpload, partUrl, partUrls, resumeUpload, finishUpload, abortUpload, saveThumbnail]);
  return { transport, saveThumbnail };
}
