import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

type Run = Pick<Doc<'projects'>, 'aiRunning'>;

/** The timeline is locked for the whole run, from the moment it starts: while the model reads and plans, no user
 * save, undo or background placement (import, upscale, cut-out) moves the revision under it. Placements wait for
 * the run to end. `ctx` stays for the callers' shape. */
export async function editingWorkflowActive(_ctx: QueryCtx | MutationCtx, project: Run) {
  return !!project.aiRunning;
}
