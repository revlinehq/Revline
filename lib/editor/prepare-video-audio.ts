import type { Id } from '@/convex/_generated/dataModel';
import type { ConvexReactClient } from 'convex/react';
import { api } from '@/convex/_generated/api';

type MediaClient = Pick<ConvexReactClient, 'mutation' | 'query'>;
async function waitForPreparation(convex: MediaClient, taskId: Id<'mediaTasks'>) {
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const task = await convex.query(api.mediaTasks.get, { taskId });
    if (task.status === 'completed') return;
    if (task.status === 'failed' || task.status === 'cancelled') throw new Error(task.error ?? 'Media preparation failed.');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Your media is still processing in the background. Reopen the project when it is ready.');
}
export async function prepareVideoAudio(convex: MediaClient, projectId: Id<'projects'>, assetId: Id<'assets'>) {
  const video = await convex.query(api.assets.get, { projectId, assetId });
  if (!video.audioExtracted) await waitForPreparation(convex, await convex.mutation(api.mediaTasks.start, { projectId, assetId, kind: 'extract' }));
  return (await convex.query(api.assets.get, { projectId, assetId })).audioAssetId ?? null;
}
export async function prepareAudioWaveform(convex: MediaClient, projectId: Id<'projects'>, assetId: Id<'assets'>) {
  const asset = await convex.query(api.assets.get, { projectId, assetId });
  if (!asset.waveform) await waitForPreparation(convex, await convex.mutation(api.mediaTasks.start, { projectId, assetId, kind: 'waveform' }));
}
