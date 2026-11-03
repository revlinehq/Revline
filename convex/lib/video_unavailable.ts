import type { MutationCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { writeProject } from './project_data';

/** #55's same-run provider latch, shared by tool and worker completion. */
export async function persistVideoUnavailable(ctx:MutationCtx,project:Pick<Doc<'projects'>,'_id'|'aiRunning'|'aiRunId'|'aiAnalysisUsage'>,runId:string,reason:string) {
  if(!project.aiRunning||project.aiRunId!==runId)return;
  const usage=project.aiAnalysisUsage?.runId===runId?project.aiAnalysisUsage:{runId,enqueued:0};
  await writeProject(ctx,project._id,{aiAnalysisUsage:{...usage,videoUnavailable:reason.slice(0,1000)}});
}
