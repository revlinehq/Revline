import { reportClientFailure } from '@/lib/incident-client';
import type { Id } from '@/convex/_generated/dataModel';
import { inspectMedia } from './media';
import { uploadPartSize } from './limits';
import type { UploadActivity } from './multipart-upload';
import { uploadResumable, type ResumableTransport } from './upload-resume';

type SourceMetadata = Awaited<ReturnType<typeof inspectMedia>>;

export type SourceUploadTransport = Omit<ResumableTransport<Id<'r2Uploads'>, Id<'assets'> | null>, 'start'> & {
  start: (metadata: SourceMetadata) => Promise<{ uploadId: Id<'r2Uploads'>; partSize: number }>;
  saveThumbnail?: (assetId:Id<'assets'>,thumbnail:Blob)=>Promise<void>;
  onThumbnail?: (thumbnail: Blob) => void;
};

/** What a progress label says instead of the usual wording while an upload resumes or waits.
 * Pass `percent` only where no percentage is already shown beside the label. */
export function uploadActivityLabel(activity: UploadActivity, percent?: number) {
  return activity === 'resuming' ? `Resuming…${percent === undefined ? '' : ` ${percent}%`}` : activity === 'waiting' ? 'Waiting for your connection…' : undefined;
}

export type SourceUploadPhase = 'reading' | 'uploading' | 'saving';

export async function uploadSourceFile(
  file: File,
  transport: SourceUploadTransport,
  /** `activity` replaces the phase's usual label while an upload resumes or waits for the connection. */
  onProgress: (percent: number, phase: SourceUploadPhase, activity?: string) => void,
  signal?: AbortSignal,
): Promise<Id<'assets'>> {
  // Match the cloud transport's limits before reading or transferring any bytes.
  if (!uploadPartSize(file.size)) throw new Error(`“${file.name}” is larger than storage accepts in one upload (about 930 GB). Split it before importing.`);
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
    signal?.throwIfAborted();
    log('Metadata ready; opening cloud upload');
    const assetId = await uploadResumable(
      file,
      { ...transport, start: () => transport.start(metadata) },
      (percent, activity) => onProgress(percent, 'uploading', uploadActivityLabel(activity)),
      signal,
      () => { onProgress(100, 'saving'); log('Transfer finished; finalizing storage'); },
    );
    if (!assetId) throw new Error('The upload did not return media.');
    // The source is already durable. A slow or blocked optional image request must
    // not turn a completed upload into an import error or delay opening its clip.
    savedAssetId=assetId;saveThumbnail();
    log('Source saved; upload complete');
    return assetId;
  } catch (error) {
    reportClientFailure(error, 'lib/editor/upload-source');
    log('Upload failed');
    throw error;
  }
}
