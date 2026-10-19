import {v} from 'convex/values';
import {vResultValidator,vWorkflowId} from '@convex-dev/workflow';
import {internal} from './_generated/api';
import {internalMutation} from './_generated/server';
import {mediaWorkflow} from './lib/workflows';
import {assistantRunArgs,MAX_ASSISTANT_SEGMENTS} from './lib/assistant_run';
import {projectRun,writeProject} from './lib/project_data';

/** Journal each completed action. Paid generation steps are never retried. */
export const run=mediaWorkflow.define({args:assistantRunArgs,returns:v.null(),handler:async(step,args):Promise<null>=>{
  let continuation:{segment:number;savedEdits:number}|undefined;
  for(let segment=0;segment<MAX_ASSISTANT_SEGMENTS;segment++){
    const active:boolean=await step.runQuery(internal.assistant.isRunActive,{projectId:args.projectId,ownerId:args.ownerId,runId:args.runId});
    if(!active)return null;
    const next:{segment:number;savedEdits:number}|null=await step.runAction(internal.assistantActions.respond,{...args,durable:true,...(continuation?{continuation}:{})},{retry:false});
    if(!next)return null;
    continuation=next;
  }
  return null;
}});
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
export const cleanup=internalMutation({args:{workflowId:vWorkflowId},returns:v.null(),handler:async(ctx,{workflowId})=>{await mediaWorkflow.cleanup(ctx,workflowId);return null;}});
