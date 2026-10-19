import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { projectRun } from './lib/project_data';
import { validateTimeline } from './lib/timeline';
import { clipValidator, timelineValidator } from './schema';
import { effectPlanValidator, compositionReviewResult } from './lib/effect_plan';
import { compositionReviewBudget, compositionReviewWindow, countedReviewPlanIds, currentReviewPlanIds, MAX_COMPOSITION_REVIEW_ATTEMPTS } from '../lib/ai/composition-review';
import { effectPlanInput, effectDisabledReference, preservePlanOriginals, mergeEffectPlans, effectReviewBindings, type EffectPlan } from '../lib/ai/edit-plan';
import { enqueueMediaTask, cancelMediaTask } from './mediaTasks';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
const runArgs={projectId:v.id('projects'),ownerId:v.string(),runId:v.string()};
async function active(ctx:MutationCtx|QueryCtx,args:{projectId:Id<'projects'>;ownerId:string;runId:string}) {
  const run=await projectRun(ctx,args.projectId,args.ownerId);
  if(!run.aiRunning||run.aiRunId!==args.runId)throw new ConvexError('AI run is no longer active.');
}
export const readPlan=internalQuery({args:runArgs,returns:v.array(effectPlanValidator),handler:async(ctx,args)=>{
  await active(ctx,args);
  const plan=await ctx.db.query('assistantPlans').withIndex('by_project',q=>q.eq('projectId',args.projectId)).unique();
  return plan?.runId===args.runId?plan.plans:[];
}});
export const completionState=internalQuery({args:{...runArgs,timeline:timelineValidator,expectedRevision:v.number()},returns:v.object({plans:v.array(effectPlanValidator),validReviews:v.array(v.object({planIds:v.array(v.string()),output:v.object({...compositionReviewResult.fields,reviewed:v.literal(true),stale:v.literal(false),currentRevision:v.number()})}))}),handler:async(ctx,args)=>{
  await active(ctx,args);
  const project=(await ctx.db.get(args.projectId))!;
  if((project.revision??0)!==args.expectedRevision)throw new ConvexError('The timeline changed elsewhere. Inspect before completing review.');
  const saved=await ctx.db.query('assistantPlans').withIndex('by_project',q=>q.eq('projectId',args.projectId)).unique();
  const plans=saved?.runId===args.runId?saved.plans:[];
  if(!plans.length)return {plans,validReviews:[]};
  const recent=(await ctx.db.query('compositionReviews').withIndex('by_project',q=>q.eq('projectId',args.projectId)).order('desc').take(MAX_COMPOSITION_REVIEW_ATTEMPTS+1)).filter(review=>review.runId===args.runId&&review.ownerId===args.ownerId&&review.status==='completed');
  const seen=new Set<string>(),validReviews=[];
  for(const review of recent){
    const current=new Set(currentReviewPlanIds(review,args.timeline,plans));
    for(const plan of review.plans){
      if(seen.has(plan.id))continue;
      seen.add(plan.id);
      if(!current.has(plan.id)||!review.result)continue;
      // Preserve the latest judgment, including failure or uncertainty. Split
      // paired receipts so a later review of one plan cannot hide its verdict.
      validReviews.push({planIds:[plan.id],output:{...review.result,observations:review.result.observations.filter(item=>item.planId===plan.id),checks:review.result.checks.filter(item=>item.planId===plan.id),reviewed:true as const,stale:false as const,revision:args.expectedRevision,currentRevision:args.expectedRevision}});
    }
  }
  return {plans,validReviews};
}});
export const savePlan=internalMutation({args:{...runArgs,plans:v.array(effectPlanValidator),originals:v.array(clipValidator)},returns:v.null(),handler:async(ctx,args)=>{
  await active(ctx,args);
  if(args.plans.length<1||args.plans.length>8||args.originals.length>8||new Set(args.plans.map(p=>p.id)).size!==args.plans.length)throw new ConvexError('Plan one to eight uniquely identified effects.');
  for(const plan of args.plans)effectPlanInput.parse(plan);
  const previous=await ctx.db.query('assistantPlans').withIndex('by_project',q=>q.eq('projectId',args.projectId)).unique();
  const sameRun=previous?.runId===args.runId;
  const reviews=sameRun&&previous.reviews>0?(await ctx.db.query('compositionReviews').withIndex('by_project',q=>q.eq('projectId',args.projectId)).order('desc').take(MAX_COMPOSITION_REVIEW_ATTEMPTS+1)).filter(review=>review.runId===args.runId&&review.status!=='failed'):[];
  let plans:EffectPlan[];
  try{plans=mergeEffectPlans(sameRun?previous.plans:[],args.plans,new Set(reviews.flatMap(review=>review.plans.map(plan=>plan.id))));}catch(error){throw new ConvexError(error instanceof Error?error.message:'Effect expectations could not be saved.');}
  const targets=new Set(plans.map(plan=>plan.outputClipId??plan.targetClipId));
  const originals=[...new Map([...(sameRun?previous.originals:[]),...args.originals].map(clip=>[clip.id,clip])).values()].filter(clip=>targets.has(clip.id));
  const values={projectId:args.projectId,ownerId:args.ownerId,runId:args.runId,plans,originals:preservePlanOriginals(originals,sameRun?previous.originals:[]),reviews:sameRun?previous.reviews:0,createdAt:Date.now()};
  if(previous)await ctx.db.replace(previous._id,values);else await ctx.db.insert('assistantPlans',values);return null;
}});
export const request=internalMutation({args:{...runArgs,expectedRevision:v.number(),timeline:timelineValidator,planIds:v.array(v.string()),bindings:v.array(v.object({planId:v.string(),clipId:v.string()}))},returns:v.id('compositionReviews'),handler:async(ctx,args)=>{
  await active(ctx,args);
  const project=(await ctx.db.get(args.projectId))!;
  if((project.revision??0)!==args.expectedRevision)throw new ConvexError('The timeline changed elsewhere. Inspect before reviewing.');
  await validateTimeline(ctx,project,args.timeline);
  const saved=await ctx.db.query('assistantPlans').withIndex('by_project',q=>q.eq('projectId',args.projectId)).unique();
  if(!saved||saved.runId!==args.runId)throw new ConvexError('Save the effect expectations before reviewing.');
  const recent=(await ctx.db.query('compositionReviews').withIndex('by_project',q=>q.eq('projectId',args.projectId)).order('desc').take(MAX_COMPOSITION_REVIEW_ATTEMPTS+1)).filter(review=>review.runId===args.runId);
  let completed:number;
  try{completed=compositionReviewBudget(saved.reviews,recent.map(review=>({status:review.status,planIds:review.plans.map(plan=>plan.id),countedPlanIds:countedReviewPlanIds(review,args.timeline,saved.plans)})),args.planIds);}catch(error){throw new ConvexError(error instanceof Error?error.message:'Rendered review is unavailable.');}
  if(!args.planIds.length||args.planIds.length>2||new Set(args.planIds).size!==args.planIds.length)throw new ConvexError('Review one or two planned effects in a short window.');
  const plans=args.planIds.map(id=>saved.plans.find(plan=>plan.id===id));
  if(plans.some(plan=>!plan))throw new ConvexError('Save the effect expectations before reviewing.');
  let resolved:{planId:string;clipId:string}[];
  try{resolved=effectReviewBindings(plans as EffectPlan[],args.timeline,args.bindings);}catch(error){throw new ConvexError(error instanceof Error?error.message:'Review output is unavailable.');}
  const bound=(plans as EffectPlan[]).map(plan=>({...plan,outputClipId:resolved.find(binding=>binding.planId===plan.id)!.clipId}));
  // A separate expectation is an initial review, not a retry requiring edits.
  const alreadyReviewed=new Set(recent.filter(review=>review.status==='completed').flatMap(review=>currentReviewPlanIds(review,args.timeline,saved.plans)));
  if(completed&&args.planIds.every(id=>alreadyReviewed.has(id)))throw new ConvexError('Make one targeted fix before reviewing again.');
  let start:number,end:number;
  try{({start,end}=compositionReviewWindow(bound,args.timeline.fps,Math.max(...args.timeline.clips.map(clip=>clip.start+clip.duration))));}catch(error){throw new ConvexError(error instanceof Error?error.message:'Rendered review window is unavailable.');}
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
