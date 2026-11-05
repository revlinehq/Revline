import { join } from 'node:path';
import { z } from 'zod';
import { api } from '../../convex/_generated/api';
import type { MediaWorkItem } from '../../convex/lib/media_task_contract';
import { downloadOwnedMedia } from '../media-analysis/io';
import { uploadMediaFile, type UploadContext } from './upload-media-file';
import { extractPreviewPoster, inspectPreviewVideo, preparePreviewVideo, probePreviewVideo } from './preview-video';
import type { ReportMediaActivity } from '../media-analysis/activity';

const uploadedPoster = z.object({ storageId: z.string().min(1) });

export async function publishPlaybackPoster(
  input: string,
  directory: string,
  task: MediaWorkItem,
  context: UploadContext,
  signal: AbortSignal,
) {
  if (task.asset?.thumbnailStorageId) return;
  const credentials = { taskId: task.taskId, leaseToken: task.leaseToken };
  const bytes = await extractPreviewPoster(
    input,
    join(directory, 'poster.jpg'),
    signal,
    Math.min(0.5, (task.asset?.duration ?? 1) / 2),
  );
  if (bytes.length > 128 * 1024) throw new Error('The poster exceeded its storage limit.');
  const exclusive = context.exclusive ?? (<T>(work: () => Promise<T>) => work());
  const url = await exclusive(() => context.convex.mutation(api.playback.posterUploadUrl, credentials));
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: new Uint8Array(bytes),
    signal,
  });
  if (!response.ok) throw new Error('Could not save the footage poster.');
  const { storageId } = uploadedPoster.parse(await response.json());
  // The storage service returns a string; Convex validates the storage id at the mutation boundary.
  await exclusive(() =>
    context.convex.mutation(api.playback.attachPoster, {
      ...credentials,
      storageId,
    }),
  );
}

export async function identifyPlayback(
  input: string,
  task: MediaWorkItem,
  context: UploadContext,
  signal: AbortSignal,
) {
  const source = await inspectPreviewVideo(input, signal),
    exclusive = context.exclusive ?? (<T>(work: () => Promise<T>) => work());
  await exclusive(() =>
    context.convex.mutation(api.playback.identify, {
      taskId: task.taskId,
      leaseToken: task.leaseToken,
      originalPlayable: source.originalPlayable,
    }),
  );
  return source;
}

export async function prepareTimelinePlayback(
  input: string,
  directory: string,
  task: MediaWorkItem,
  context: UploadContext,
  signal: AbortSignal,
  onProgress: (percent: number) => void,
  onActivity?: ReportMediaActivity,
) {
  const asset = task.asset;
  if (!asset || asset.kind !== 'video') throw new Error('Playback preparation needs a video source.');
  const source = await identifyPlayback(input, task, context, signal),
    credentials = { taskId: task.taskId, leaseToken: task.leaseToken };
  const output = join(directory, 'preview.mp4');
  const save = async (path: string, range?: { start: number; end: number }, uploadSignal = signal) => {
    const metadata = await probePreviewVideo(path, uploadSignal);
    await uploadMediaFile(
      path,
      {
        ...credentials,
        projectId: task.projectId,
        purpose: 'preview',
        sourceAssetId: asset._id,
        previewVersion: 1,
        previewFps: source.fps,
        ...(range ? { previewRange: { start: range.start, end: range.end } } : {}),
        kind: 'video',
        contentType: 'video/mp4',
        fileName: `${asset.fileName.replace(/\.[^.]+$/, '').slice(0, 230)}.preview.mp4`,
        duration: range ? range.end - range.start : metadata.duration,
        width: metadata.width,
        height: metadata.height,
      },
      context,
      uploadSignal,
    );
  };
  onActivity?.('preparing-playback');
  const latest = await context.convex.query(api.mediaTasks.work, credentials);
  await preparePreviewVideo(input, output, signal, onProgress, {
    source,
    ranges: latest.previewRanges ?? [],
    currentRanges: async () => (await context.convex.query(api.mediaTasks.work, credentials)).previewRanges ?? [],
    reuseSegment: async (path, range, currentSignal) => {
      const saved = latest.asset?.previewSegments?.find(
        (segment) => Math.abs(segment.start - range.start) < 1e-6 && Math.abs(segment.end - range.end) < 1e-6,
      );
      if (!saved) return false;
      await downloadOwnedMedia(saved.url, path, new URL(saved.url).origin, saved.size, currentSignal);
      return true;
    },
    onSegment: (path, range, currentSignal) => save(path, range, currentSignal),
  });
  await save(output);
}
