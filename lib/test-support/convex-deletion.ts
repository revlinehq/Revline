import type { convexTest } from 'convex-test';
import type { Id } from '../../convex/_generated/dataModel';
import { internal } from '../../convex/_generated/api';
/** Drive only deletion batches; avoid unrelated workflow timers/network jobs. */
export async function completeDeletion(t:ReturnType<typeof convexTest>,projectId:Id<'projects'>) {
  for(let page=0;page<100;page++) {
    const project=await t.run(ctx=>ctx.db.get(projectId));if(!project)return;
    await t.mutation(internal.projectDeletion.batch,{projectId,ownerId:project.ownerId});
  }
  throw new Error('Deletion did not finish within its fixture budget');
}
