import type { Id } from '@/convex/_generated/dataModel';
import { addMediaClip, patchClip, separateVideoClips } from './operations';
import { aspectRatioForSize, layerGroup, timelineDuration, type AspectRatio, type MediaAsset, type Timeline } from './types';
import type { SourceUploadPhase } from './upload-source';
import { aggregateFootageProgress, preparedFootageProgress, transferProgress } from './footage-progress';
import { rememberFootageProgress } from './footage-progress-store';
import type { EditingPreparationActivity } from './prepare-media-for-editing';

export type ImportFile = { id: string; file: File };
export type ProjectImportProgress = { phase: 'preparing' | SourceUploadPhase | 'processing' | 'watching' | 'listening' | 'opening'; activity?: string; index: number; total: number; percent: number };
export type ProjectImportSession = { projectId?: Id<'projects'>; uploaded: Map<string, Id<'assets'>>; completed: Set<string>; progress: Map<string, number> };
export const createProjectImportSession = (): ProjectImportSession => ({ uploaded: new Map(), completed: new Set(), progress: new Map() });

type ImportDependencies = {
  stage: (files: File[]) => Promise<void>;
  create: (title: string, assetIds: Id<'assets'>[]) => Promise<Id<'projects'>>;
  project: (projectId: Id<'projects'>) => Promise<{ timeline: Timeline; revision: number }>;
  upload: (projectId: Id<'projects'>, file: File, progress: (percent: number, phase: SourceUploadPhase, activity?: string) => void) => Promise<Id<'assets'>>;
  asset: (projectId: Id<'projects'>, assetId: Id<'assets'>) => Promise<MediaAsset>;
  prepare?: (projectId: Id<'projects'>, asset: MediaAsset, onActivity: (activity: EditingPreparationActivity) => void) => Promise<MediaAsset>;
  save: (projectId: Id<'projects'>, timeline: Timeline, revision: number) => Promise<number>;
  acknowledge: (file: File) => Promise<void>;
};

export async function importProjectSources(
  session: ProjectImportSession,
  input: { title: string; files: ImportFile[]; assetIds: Id<'assets'>[]; placeOnTimeline?: boolean; aspectRatio?: AspectRatio },
  dependencies: ImportDependencies,
  onProgress: (progress: ProjectImportProgress) => void,
) {
  const started=Date.now();
  const log=(stage:string)=>console.info(`[import] ${new Date().toISOString()} ${stage}; total ${((Date.now()-started)/1000).toFixed(1)}s.`);
  const total = input.files.length + input.assetIds.length;
  log(`Starting ${total} source(s)`);
  const sources = [...input.assetIds.map(id => ({ id, size: 1 })), ...input.files.map(source => ({ id: source.id, size: source.file.size }))];
  const report = (value: ProjectImportProgress, sourceId?: string) => {
    if (sourceId) session.progress.set(sourceId, Math.max(session.progress.get(sourceId) ?? 0, value.percent));
    const percent = aggregateFootageProgress(sources.map(source => ({ ...source, percent: session.progress.get(source.id) ?? 0 })));
    if (session.projectId) rememberFootageProgress(`project:${session.projectId}`, percent);
    onProgress({ ...value, percent });
  };
  report({ phase: 'preparing', index: 1, total, percent: 0 });
  await dependencies.stage(input.files.filter(source => !session.completed.has(source.id)).map(source => source.file));
  log('Local draft saved');
  session.projectId ??= await dependencies.create(input.title, input.assetIds);
  const projectId = session.projectId;
  let { timeline, revision } = await dependencies.project(projectId);
  const preparations: { asset: MediaAsset; index: number; sourceId: string; source?: ImportFile }[] = [];
  const prepare = async (asset: MediaAsset, index: number, sourceId: string) => {
    if (!dependencies.prepare) return;
    const preparationStarted = Date.now();
    log(`Source ${index}/${total}: preparing playback and editing context · chat ${projectId}`);
    report({ phase: 'processing', percent: preparedFootageProgress(asset), index, total }, sourceId);
    const prepared = await dependencies.prepare(projectId, asset, activity => report({ ...activity, index, total }, sourceId));
    log(`Source ${index}/${total}: playback and editing context ready in ${((Date.now()-preparationStarted)/1000).toFixed(1)}s · chat ${projectId}`);
    // Preserve edits made while preparation continued in another view.
    ({ timeline, revision } = await dependencies.project(projectId));
    const linked = separateVideoClips(timeline, prepared);
    if (linked !== timeline) {
      report({ phase: 'saving', percent: preparedFootageProgress(prepared), index, total }, sourceId);
      revision = await dependencies.save(projectId, linked, revision);
      timeline = linked;
    }
  };

  // Saved sources are copied into this project. Prepare the copied IDs, and
  // avoid transcribing a linked audio track separately from its video source.
  if (input.assetIds.length && dependencies.prepare) {
    const sources = timeline.clips.filter(clip => clip.assetId && (clip.kind === 'video' || clip.kind === 'audio') && !(clip.kind === 'audio' && timeline.clips.some(video => video.kind === 'video' && video.linkedClipId === clip.id)));
    const ids = [...new Set(sources.map(clip => clip.assetId!))];
    for (const [index, id] of ids.entries()) preparations.push({ asset: await dependencies.asset(projectId, id as Id<'assets'>), index: index + 1, sourceId: input.assetIds[index] });
  }

  for (const [index, source] of input.files.entries()) {
    if (session.completed.has(source.id)) continue;
    const uploadProgress = (percent: number, phase: SourceUploadPhase, activity?: string) => report({ phase, ...(activity ? { activity } : {}), percent: phase === 'reading' ? 0 : transferProgress(percent), index: input.assetIds.length + index + 1, total }, source.id);
    let assetId = session.uploaded.get(source.id);
    if (!assetId) {
      const uploadStarted=Date.now();
      assetId = await dependencies.upload(projectId, source.file, uploadProgress);
      log(`Source ${index+1}/${input.files.length}: upload and cloud save took ${((Date.now()-uploadStarted)/1000).toFixed(1)}s`);
      // Retain completed uploads when fetching or saving their clips needs a retry.
      session.uploaded.set(source.id, assetId);
    }
    uploadProgress(100, 'saving');
    const asset = await dependencies.asset(projectId, assetId);
    // Follow the first picture only when the caller has not chosen a format.
    if (!input.aspectRatio && (asset.kind === 'video' || asset.kind === 'image') && asset.width && asset.height && !timeline.clips.some(clip => layerGroup(clip.kind) === 'visual')) {
      const aspectRatio = aspectRatioForSize(asset.width, asset.height);
      if (aspectRatio !== timeline.aspectRatio) { const next = { ...timeline, aspectRatio }; revision = await dependencies.save(projectId, next, revision); timeline = next; }
    }
    if (input.placeOnTimeline !== false && !timeline.clips.some(clip => clip.assetId === assetId)) {
      const group = layerGroup(asset.kind);
      const end = timelineDuration({ ...timeline, clips: timeline.clips.filter(clip => layerGroup(clip.kind) === group) });
      const duration = asset.kind === 'image' ? 5 : asset.duration ?? 5;
      // Ignore sources shorter than a project frame.
      if (duration >= 1 / timeline.fps) {
        const id = crypto.randomUUID();
        const next = patchClip(addMediaClip(timeline, asset, id, end), id, { duration });
        revision = await dependencies.save(projectId, next, revision);
        timeline = next;
      }
    }
    preparations.push({ asset, index: input.assetIds.length + index + 1, sourceId: source.id, source });
  }
  // Saving an upload already starts its durable background tasks. Transfer the
  // remaining sources while those run instead of holding the next file for AI.
  // Apply prepared audio/timeline changes serially after all transfers finish.
  for (const { asset, index, sourceId, source } of preparations) {
    await prepare(asset, index, sourceId);
    if (source) {
      await dependencies.acknowledge(source.file);
      session.completed.add(source.id);
    }
  }
  report({ phase: 'opening', index: Math.max(1, total), total, percent: 0 });
  log(`Sources, audio and editing context ready; opening editor · chat ${projectId}`);
  return projectId;
}
