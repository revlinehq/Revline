import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { projectRun } from './lib/project_data';
import { validateTimeline } from './lib/timeline';
import { clipValidator, timelineValidator } from './schema';
import { effectPlanValidator, compositionReviewResult } from './lib/effect_plan';
import { equalTimelineValue } from '../lib/editor/timeline-equality';
import { effectPlanInput, effectDisabledReference, type EffectPlan } from '../lib/ai/edit-plan';
import { enqueueMediaTask, cancelMediaTask } from './mediaTasks';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
const runArgs={projectId:v.id('projects'),ownerId:v.string(),runId:v.string()};
async function active(ctx:MutationCtx|QueryCtx,args:{projectId:Id<'projects'>;ownerId:string;runId:string}) {
  const run=await projectRun(ctx,args.projectId,args.ownerId);
  if(!run.aiRunning||run.aiRunId!==args.runId)throw new ConvexError('AI run is no longer active.');
}
export const savePlan=internalMutation({args:{...runArgs,plans:v.array(effectPlanValidator),originals:v.array(clipValidator)},returns:v.null(),handler:async(ctx,args)=>{
  await active(ctx,args);
  if(args.plans.length<1||args.plans.length>8||args.originals.length>8||new Set(args.plans.map(p=>p.id)).size!==args.plans.length)throw new ConvexError('Plan one to eight uniquely identified effects.');
  for(const plan of args.plans)effectPlanInput.parse(plan);
  const previous=await ctx.db.query('assistantPlans').withIndex('by_project',q=>q.eq('projectId',args.projectId)).unique();
  if(previous?.runId===args.runId&&previous.reviews>0)throw new ConvexError('Keep the original expectations after review; adjust the edit once.');
  const values={projectId:args.projectId,ownerId:args.ownerId,runId:args.runId,plans:args.plans,originals:args.originals,reviews:previous?.runId===args.runId?previous.reviews:0,createdAt:Date.now()};
  if(previous)await ctx.db.replace(previous._id,values);else await ctx.db.insert('assistantPlans',values);return null;
}});
export const request=internalMutation({args:{...runArgs,expectedRevision:v.number(),timeline:timelineValidator,planIds:v.array(v.string()),bindings:v.array(v.object({planId:v.string(),clipId:v.string()}))},returns:v.id('compositionReviews'),handler:async(ctx,args)=>{
  await active(ctx,args);
  const project=(await ctx.db.get(args.projectId))!;
  if((project.revision??0)!==args.expectedRevision)throw new ConvexError('The timeline changed elsewhere. Inspect before reviewing.');
  await validateTimeline(ctx,project,args.timeline);
  const saved=await ctx.db.query('assistantPlans').withIndex('by_project',q=>q.eq('projectId',args.projectId)).unique();
  if(!saved||saved.runId!==args.runId||saved.reviews>=2)throw new ConvexError('Review allows one initial check and one fix pass per run.');
  if(saved.reviews===1){const prior=await ctx.db.query('compositionReviews').withIndex('by_project',q=>q.eq('projectId',args.projectId)).order('desc').first();if(!prior||prior.runId!==args.runId||prior.status!=='completed'||equalTimelineValue(prior.timeline,args.timeline))throw new ConvexError('Finish the initial review and make one targeted fix before reviewing again.');}
  if(!args.planIds.length||args.planIds.length>2||new Set(args.planIds).size!==args.planIds.length)throw new ConvexError('Review one or two planned effects in a short window.');
  const plans=args.planIds.map(id=>saved.plans.find(plan=>plan.id===id));
  if(plans.some(plan=>!plan))throw new ConvexError('Save the effect expectations before reviewing.');
  const bound=(plans as EffectPlan[]).map(plan=>({...plan,outputClipId:args.bindings.find(binding=>binding.planId===plan.id)?.clipId??plan.outputClipId??plan.targetClipId}));
  for(const plan of bound)if(!args.timeline.clips.some(clip=>clip.id===plan.outputClipId))throw new ConvexError('The planned effect is missing.');
  const start=Math.max(0,Math.min(...bound.map(plan=>plan.start))-1/args.timeline.fps);
  const end=Math.min(start+3,Math.max(...args.timeline.clips.map(clip=>clip.start+clip.duration)),Math.max(...bound.map(plan=>Math.max(plan.start+plan.duration,plan.checks?.returnBy??0)))+2/args.timeline.fps);
  if(end<=start||end-start>3.00001)throw new ConvexError('Choose expectations spanning at most three seconds for rendered review.');
  const reference=effectDisabledReference(args.timeline,bound,saved.originals);
  const used=new Set([...args.timeline.clips,...reference.clips].filter(clip=>clip.kind!=='audio'&&clip.assetId&&(clip.start<end&&clip.start+clip.duration>start||args.timeline.clips.some(transition=>transition.start<end&&transition.start+transition.duration>start&&(transition.transition?.fromClipId===clip.id||transition.transition?.toClipId===clip.id)))).map(clip=>clip.assetId));
  const assetIds=[];
  for(const value of used){const id=ctx.db.normalizeId('assets',value!);const asset=id?await ctx.db.get(id):null;if(!asset||asset.ownerId!==args.ownerId||asset.projectId!==args.projectId)throw new ConvexError('Review source media is unavailable.');assetIds.push(asset._id);}
  const reviewId=await ctx.db.insert('compositionReviews',{...runFields(args),revision:args.expectedRevision,timeline:args.timeline,reference,plans:bound,assetIds,start,end,status:'queued',createdAt:Date.now()});
  const taskId=await enqueueMediaTask(ctx,{ownerId:args.ownerId,projectId:args.projectId,kind:'review',reviewId,requiredProcessorVersion:2});
  await ctx.db.patch(reviewId,{taskId});await ctx.db.patch(saved._id,{reviews:saved.reviews+1});return reviewId;
}});
function runFields(args:{projectId:Id<'projects'>;ownerId:string;runId:string}){return {projectId:args.projectId,ownerId:args.ownerId,runId:args.runId};}
export const get=internalQuery({args:{...runArgs,reviewId:v.id('compositionReviews')},returns:v.object({status:v.union(v.literal('queued'),v.literal('completed'),v.literal('failed')),error:v.optional(v.string()),result:v.optional(compositionReviewResult)}),handler:async(ctx,args)=>{
  await active(ctx,args);const review=await ctx.db.get(args.reviewId);
  if(!review||review.ownerId!==args.ownerId||review.projectId!==args.projectId||review.runId!==args.runId)throw new ConvexError('Review not found.');
  return {status:review.status,error:review.error,result:review.result};
}});
export const cancel=internalMutation({args:{...runArgs,reviewId:v.id('compositionReviews')},returns:v.null(),handler:async(ctx,args)=>{
  const review=await ctx.db.get(args.reviewId);
  if(review?.ownerId===args.ownerId&&review.projectId===args.projectId&&review.runId===args.runId&&review.status==='queued'){
    if(review.taskId)await cancelMediaTask(ctx,review.taskId);await ctx.db.patch(review._id,{status:'failed',error:'Composition review stopped.'});
  }return null;
}});
export const prune=internalMutation({args:{},returns:v.null(),handler:async ctx=>{
  const old=await ctx.db.query('compositionReviews').withIndex('by_created',q=>q.lt('createdAt',Date.now()-7*86400000)).take(50);
  for(const review of old){if(review.taskId)await cancelMediaTask(ctx,review.taskId);await ctx.db.delete(review._id);}
  if(old.length===50)await ctx.scheduler.runAfter(0,internal.compositionReview.prune,{});return null;
}});
