import type { Id } from '@/convex/_generated/dataModel';
import { inspectMedia, uploadMultipart } from './media';

type SourceMetadata = Awaited<ReturnType<typeof inspectMedia>>;
type MultipartParts = Awaited<ReturnType<typeof uploadMultipart>>;

export type SourceUploadTransport = {
  start: (metadata: SourceMetadata) => Promise<{ uploadId: Id<'r2Uploads'>; partSize: number }>;
  partUrl: (uploadId: Id<'r2Uploads'>, partNumber: number) => Promise<string>;
  complete: (uploadId: Id<'r2Uploads'>, parts: MultipartParts) => Promise<Id<'assets'> | null>;
  abort: (uploadId: Id<'r2Uploads'>) => Promise<unknown>;
};

export type SourceUploadPhase = 'reading' | 'uploading' | 'saving';

export async function uploadSourceFile(
  file: File,
  transport: SourceUploadTransport,
  onProgress: (percent: number, phase: SourceUploadPhase) => void,
): Promise<Id<'assets'>> {
  let uploadId: Id<'r2Uploads'> | undefined;
  let completed = false;

  try {
    onProgress(0, 'reading');
    const metadata = await inspectMedia(file);
    const upload = await transport.start(metadata);
    uploadId = upload.uploadId;
    onProgress(0, 'uploading');
    const parts = await uploadMultipart(
      file,
      upload.partSize,
      partNumber => transport.partUrl(upload.uploadId, partNumber),
      percent => onProgress(percent, 'uploading'),
    );
    onProgress(100, 'saving');
    const assetId = await transport.complete(upload.uploadId, parts);
    completed = true;
    if (!assetId) throw new Error('The upload did not return media.');
    return assetId;
  } catch (error) {
    if (uploadId && !completed) await transport.abort(uploadId).catch(() => undefined);
    throw error;
  }
}
