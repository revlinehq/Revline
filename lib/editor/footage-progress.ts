import type { MediaAsset } from './types';
import { previewRangeReady } from './preview-segments';

export type FootageTask = { kind: string; status: string; progress: number; assetId?: string };

/** Transfer is usually brief; playback preparation and transcription dominate opening. */
export const FOOTAGE_PROGRESS = { transfer: 25, playback: 35, audio: 10, analysis: 20, opening: 10 } as const;
export const clampProgress = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
export const transferProgress = (percent: number) => clampProgress(percent) * FOOTAGE_PROGRESS.transfer / 100;

/** Independent tasks can finish in any order. Each contributes its own share once. */
export function preparedFootageProgress(asset: MediaAsset, tasks: readonly FootageTask[] = []) {
  if (asset.kind === 'image' || asset.kind === 'model') return 90;
  const taskProgress = (kind: string) => {
    const task = tasks.find(task => task.kind === kind && task.assetId === asset._id);
    return task?.status === 'completed' ? 1 : clampProgress(task?.progress ?? 0) / 100;
  };
  const playback = asset.kind !== 'video' || previewRangeReady(asset, { start: 0, end: asset.duration ?? 1 }) ? 1 : taskProgress('preview');
  const audio = asset.kind === 'video' ? asset.audioExtracted || asset.audioAssetId ? 1 : taskProgress('extract') : asset.waveform ? 1 : taskProgress('waveform');
  const silent = asset.kind === 'video' && asset.audioExtracted && !asset.audioAssetId;
  const analysis = silent || asset.analysis?.transcript || asset.analysisKinds?.includes('transcribe') ? 1 : taskProgress('transcribe');
  return FOOTAGE_PROGRESS.transfer + FOOTAGE_PROGRESS.playback * playback + FOOTAGE_PROGRESS.audio * audio + FOOTAGE_PROGRESS.analysis * analysis;
}

/** Fixed weights prevent a new file or a later stage from restarting a batch. */
export function aggregateFootageProgress(sources: readonly { percent: number; size?: number }[]) {
  const total = sources.reduce((sum, source) => sum + Math.max(1, source.size ?? 1), 0);
  return total ? sources.reduce((sum, source) => sum + clampProgress(source.percent) * Math.max(1, source.size ?? 1), 0) / total : 0;
}
