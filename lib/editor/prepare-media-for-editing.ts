import type { Id } from '@/convex/_generated/dataModel';
import type { ConvexReactClient } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '@/convex/_generated/api';
import { mediaTaskActivityLabel } from '@/lib/media-analysis/activity';
import { preparedFootageProgress } from './footage-progress';
import type { MediaAsset } from './types';

type MediaClient = Pick<ConvexReactClient, 'mutation' | 'query'>;
type PreparationKind = 'extract' | 'waveform' | 'transcribe';
type TaskState = FunctionReturnType<typeof api.mediaTasks.get>;
type PreparationTask = { taskId: Id<'mediaTasks'>; completed: boolean; state?: TaskState };
export type EditingPreparationActivity = { phase: 'processing' | 'watching' | 'listening'; activity: string; percent: number };

const taskOrder: PreparationKind[] = ['extract', 'waveform', 'transcribe'];
const phases: Record<PreparationKind, EditingPreparationActivity['phase']> = { extract: 'processing', waveform: 'processing', transcribe: 'listening' };
const labels: Record<PreparationKind, string> = { extract: 'Preparing audio…', waveform: 'Preparing waveform…', transcribe: 'Listening to audio…' };
const timeoutMessage = 'Media preparation is taking longer than expected. Retry to check the existing background tasks; your upload is saved.';

/** Only audio preparation and transcription gate editing; optional overviews start after opening. */
export async function prepareMediaForEditing(
  convex: MediaClient,
  projectId: Id<'projects'>,
  assetId: Id<'assets'>,
  onActivity?: (value: EditingPreparationActivity) => void,
): Promise<MediaAsset> {
  const deadline = Date.now() + 15 * 60_000;
  const tasks = new Map<PreparationKind, PreparationTask>();
  let previous: EditingPreparationActivity | undefined;

  async function bounded<T>(call: () => Promise<T>): Promise<T> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(timeoutMessage);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([call(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(timeoutMessage)), remaining); })]);
    } finally { clearTimeout(timer); }
  }

  const readAsset = () => bounded(() => convex.query(api.assets.get, { projectId, assetId }));
  let asset: MediaAsset = await readAsset();
  if (asset.kind === 'image' || asset.kind === 'model') { onActivity?.({ phase: 'processing', activity: 'Media ready…', percent: preparedFootageProgress(asset) }); return asset; }

  function missingTasks(): PreparationKind[] {
    const missing: PreparationKind[] = [];
    if (asset.kind === 'video') {
      if (!asset.audioExtracted) missing.push('extract');
      // Extraction is authoritative: a silent video needs no transcription task.
      if (asset.audioExtracted && asset.audioAssetId && !asset.analysis?.transcript) missing.push('transcribe');
    } else {
      if (!asset.waveform) missing.push('waveform');
      if (!asset.analysis?.transcript) missing.push('transcribe');
    }
    return missing;
  }

  while (true) {
    await Promise.all(missingTasks().filter(kind => !tasks.has(kind)).map(async kind => {
      const taskId = await bounded(() => convex.mutation(api.mediaTasks.start, { projectId, assetId, kind }));
      tasks.set(kind, { taskId, completed: false });
    }));
    asset = await readAsset();
    const projectTasks = await bounded(() => convex.query(api.mediaTasks.list, { projectId }));
    const percent = preparedFootageProgress(asset, projectTasks);
    const active = taskOrder.filter(kind => tasks.has(kind) && !tasks.get(kind)!.completed);
    if (!active.length) {
      if (missingTasks().length) throw new Error('Media preparation finished without saved results. Retry to prepare this media again.');
      onActivity?.({ phase: 'processing', activity: 'Preparing editor…', percent });
      return asset;
    }
    const snapshots = await Promise.all(active.map(kind => bounded(() => convex.query(api.mediaTasks.get, { taskId: tasks.get(kind)!.taskId }))));
    let completed = false;
    for (const [index, state] of snapshots.entries()) {
      const kind = active[index], task = tasks.get(kind)!;
      if (state.status === 'failed' || state.status === 'cancelled') {
        throw new Error(`${state.error?.trim() || `${labels[kind].replace(/…$/, '')} ${state.status}.`} Retry to prepare this media again.`);
      }
      task.state = state;
      if (state.status === 'completed') { task.completed = true; completed = true; }
    }
    if (completed) {
      asset = await readAsset();
      continue;
    }
    const kind = active[0], state = tasks.get(kind)!.state!;
    const activity = state.status === 'retrying' ? 'Retrying media preparation…' : state.activity ? mediaTaskActivityLabel({...state,kind}) : state.status === 'queued' ? `Queued · ${labels[kind]}` : labels[kind];
    const next = { phase: phases[kind], activity, percent };
    if (next.phase !== previous?.phase || next.activity !== previous?.activity || next.percent !== previous?.percent) { onActivity?.(next); previous = next; }
    await bounded(() => new Promise<void>(resolve => setTimeout(resolve, 1000)));
  }
}
