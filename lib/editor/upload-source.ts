import type { Id } from '@/convex/_generated/dataModel';
import { inspectMedia, uploadMultipart } from './media';

type SourceMetadata = Awaited<ReturnType<typeof inspectMedia>>;
type MultipartParts = Awaited<ReturnType<typeof uploadMultipart>>;

export type SourceUploadTransport = {
  start: (metadata: SourceMetadata) => Promise<{ uploadId: Id<'r2Uploads'>; partSize: number }>;
  partUrl: (uploadId: Id<'r2Uploads'>, partNumber: number) => Promise<string>;
  complete: (uploadId: Id<'r2Uploads'>, parts: MultipartParts) => Promise<Id<'assets'> | null>;
  abort: (uploadId: Id<'r2Uploads'>) => Promise<unknown>;
  saveThumbnail?: (assetId:Id<'assets'>,thumbnail:Blob)=>Promise<void>;
  onThumbnail?: (thumbnail: Blob) => void;
};

export type SourceUploadPhase = 'reading' | 'uploading' | 'saving';

export async function uploadSourceFile(
  file: File,
  transport: SourceUploadTransport,
  onProgress: (percent: number, phase: SourceUploadPhase) => void,
): Promise<Id<'assets'>> {
  let uploadId: Id<'r2Uploads'> | undefined;
  let completed = false;
  let thumbnail:Blob|undefined;
  let savedAssetId:Id<'assets'>|undefined;
  const started=Date.now();
  const log=(stage:string)=>console.info(`[upload] ${new Date().toISOString()} ${stage} (${((Date.now()-started)/1000).toFixed(1)}s since start).`);
  const saveThumbnail=()=>{
    if(!thumbnail||!savedAssetId||!transport.saveThumbnail)return;
    const image=thumbnail,id=savedAssetId;thumbnail=undefined;
    void Promise.resolve().then(()=>transport.saveThumbnail!(id,image)).catch(()=>undefined);
  };

  try {
    log('Reading media metadata');
    onProgress(0, 'reading');
    const metadata = await inspectMedia(file,transport.saveThumbnail || transport.onThumbnail ? image=>{thumbnail=image;transport.onThumbnail?.(image);saveThumbnail();} : undefined,false);
    log('Metadata ready; opening cloud upload');
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
    log('Transfer finished; finalizing cloud storage');
    const assetId = await transport.complete(upload.uploadId, parts);
    completed = true;
    if (!assetId) throw new Error('The upload did not return media.');
    // The source is already durable. A slow or blocked optional image request must
    // not turn a completed upload into an import error or delay opening its clip.
    savedAssetId=assetId;saveThumbnail();
    log('Source saved; upload complete');
    return assetId;
  } catch (error) {
    log('Upload failed; releasing unfinished upload');
    if (uploadId && !completed) await transport.abort(uploadId).catch(() => undefined);
    throw error;
  }
}
