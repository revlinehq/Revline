import {v,type ObjectType} from 'convex/values';
import {vResultValidator,vWorkflowId,type WorkflowCtx,type WorkflowId} from '@convex-dev/workflow';
import {internal} from './_generated/api';
import {internalMutation,type MutationCtx} from './_generated/server';
import {aiWorkflow,mediaWorkflow} from './lib/workflows';
import {assistantRunArgs} from './lib/assistant_run';
import {projectRun,writeProject} from './lib/project_data';

/** A turn inside Convex when no agent runner is configured. Paid generation steps are never retried. */
const turn=async(step:WorkflowCtx,args:ObjectType<typeof assistantRunArgs>):Promise<null>=>{
  const active:boolean=await step.runQuery(internal.assistant.isRunActive,{projectId:args.projectId,ownerId:args.ownerId,runId:args.runId});
  if(active)await step.runAction(internal.assistantActions.respond,args,{retry:false});
  return null;
};
export const runTurn=aiWorkflow.define({args:assistantRunArgs,returns:v.null(),handler:turn});
/** Turns started before the AI pool split still finish on the media pool; remove once none remain. */
export const run=mediaWorkflow.define({args:assistantRunArgs,returns:v.null(),handler:turn});
export const settle=internalMutation({args:{workflowId:vWorkflowId,result:vResultValidator,context:v.object({projectId:v.id('projects'),ownerId:v.string(),runId:v.string()})},returns:v.null(),handler:async(ctx,args)=>{
  const project=await ctx.db.get(args.context.projectId);
  if(project&&project.ownerId===args.context.ownerId&&!project.deleting){
    const run=await projectRun(ctx,project._id,args.context.ownerId);
    if(run.aiWorkflowId===args.workflowId){
      await writeProject(ctx,project._id,{aiWorkflowId:undefined});
      if(run.aiRunning&&run.aiRunId===args.context.runId)await ctx.runMutation(internal.assistant.finish,{...args.context,error:'The editing request was interrupted. Your saved edits are still here. Retry unfinished steps to continue.'});
    }
  }
  await ctx.scheduler.runAfter(24*3600_000,internal.assistantWorkflow.cleanup,{workflowId:args.workflowId});
  return null;
}});
export const cleanup=internalMutation({args:{workflowId:vWorkflowId},returns:v.null(),handler:async(ctx,{workflowId})=>{await cleanupTurn(ctx,workflowId);return null;}});
// A workflow id belongs to one component; try the AI pool first, then turns from before the split.
export async function cancelTurn(ctx:MutationCtx,workflowId:WorkflowId){try{await aiWorkflow.cancel(ctx,workflowId);}catch{await mediaWorkflow.cancel(ctx,workflowId);}}
async function cleanupTurn(ctx:MutationCtx,workflowId:WorkflowId){try{await aiWorkflow.cleanup(ctx,workflowId);}catch{await mediaWorkflow.cleanup(ctx,workflowId);}}
