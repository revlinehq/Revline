import type { Id } from '@/convex/_generated/dataModel';
import { addMediaClip, patchClip, separateVideoClips } from './operations';
import { layerGroup, timelineDuration, type MediaAsset, type Timeline } from './types';
import type { SourceUploadPhase } from './upload-source';

export type ImportFile = { id: string; file: File };
export type ProjectImportProgress = { phase: 'preparing' | SourceUploadPhase | 'processing' | 'opening'; index: number; total: number; percent: number };
export type ProjectImportSession = { projectId?: Id<'projects'>; uploaded: Map<string, Id<'assets'>>; completed: Set<string> };
export const createProjectImportSession = (): ProjectImportSession => ({ uploaded: new Map(), completed: new Set() });

type ImportDependencies = {
  stage: (files: File[]) => Promise<void>;
  create: (title: string, assetIds: Id<'assets'>[]) => Promise<Id<'projects'>>;
  project: (projectId: Id<'projects'>) => Promise<{ timeline: Timeline; revision: number }>;
  upload: (projectId: Id<'projects'>, file: File, progress: (percent: number, phase: SourceUploadPhase) => void) => Promise<Id<'assets'>>;
  asset: (projectId: Id<'projects'>, assetId: Id<'assets'>) => Promise<MediaAsset>;
  prepare?: (projectId: Id<'projects'>, asset: MediaAsset) => Promise<MediaAsset>;
  save: (projectId: Id<'projects'>, timeline: Timeline, revision: number) => Promise<number>;
  acknowledge: (file: File) => Promise<void>;
};

export async function importProjectSources(
  session: ProjectImportSession,
  input: { title: string; files: ImportFile[]; assetIds: Id<'assets'>[] },
  dependencies: ImportDependencies,
  onProgress: (progress: ProjectImportProgress) => void,
) {
  const started=Date.now();
  const log=(stage:string)=>console.info(`[import] ${new Date().toISOString()} ${stage}; total ${((Date.now()-started)/1000).toFixed(1)}s.`);
  const total = input.files.length + input.assetIds.length;
  log(`Starting ${total} source(s)`);
  onProgress({ phase: 'preparing', index: 1, total, percent: 0 });
  await dependencies.stage(input.files.filter(source => !session.completed.has(source.id)).map(source => source.file));
  log('Local draft saved');
  session.projectId ??= await dependencies.create(input.title, input.assetIds);
  const projectId = session.projectId;
  let { timeline, revision } = await dependencies.project(projectId);

  for (const [index, source] of input.files.entries()) {
    if (session.completed.has(source.id)) continue;
    const report = (percent: number, phase: SourceUploadPhase) => onProgress({ phase, percent, index: input.assetIds.length + index + 1, total });
    let assetId = session.uploaded.get(source.id);
    if (!assetId) {
      const uploadStarted=Date.now();
      assetId = await dependencies.upload(projectId, source.file, report);
      log(`Source ${index+1}/${input.files.length}: upload and cloud save took ${((Date.now()-uploadStarted)/1000).toFixed(1)}s`);
      // Retain completed uploads when fetching or saving their clips needs a retry.
      session.uploaded.set(source.id, assetId);
    }
    report(100, 'saving');
    const asset = await dependencies.asset(projectId, assetId);
    if (!timeline.clips.some(clip => clip.assetId === assetId)) {
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
    if (dependencies.prepare) {
      const preparationStarted=Date.now();
      log(`Source ${index+1}/${input.files.length}: preparing audio`);
      onProgress({ phase: 'processing', percent: 100, index: input.assetIds.length + index + 1, total });
      const prepared = await dependencies.prepare(projectId, asset);
      log(`Source ${index+1}/${input.files.length}: audio ready in ${((Date.now()-preparationStarted)/1000).toFixed(1)}s`);
      // The editor may have been opened while processing continued. Preserve any
      // edits made there instead of saving the stale import snapshot over them.
      ({ timeline, revision } = await dependencies.project(projectId));
      const linked = separateVideoClips(timeline, prepared);
      if (linked !== timeline) {
        report(100, 'saving');
        revision = await dependencies.save(projectId, linked, revision);
        timeline = linked;
      }
    }
    await dependencies.acknowledge(source.file);
    session.completed.add(source.id);
  }
  onProgress({ phase: 'opening', index: Math.max(1, total), total, percent: 100 });
  log('Sources and audio ready; opening editor');
  return projectId;
}
