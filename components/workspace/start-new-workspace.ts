import { clearProjectImportJob, getProjectImportJob } from '@/lib/editor/project-import-job';
import { clearNewProjectSources } from '@/lib/editor/opening-request';
import { stashFiles } from './project-draft';

export const NEW_WORKSPACE_EVENT = 'revline:new-workspace';

/** A deliberate new workspace must not resume the previous import. */
export async function startNewWorkspace(ownerId?: string) {
  const job = getProjectImportJob(ownerId);
  if (job) clearProjectImportJob(job);
  try {
    clearNewProjectSources();
  } catch { /* The current workspace can still be cleared in memory. */ }
  window.dispatchEvent(new Event(NEW_WORKSPACE_EVENT));
  await stashFiles([]);
}
