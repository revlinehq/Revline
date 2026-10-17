/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import workflowTest from '@convex-dev/workflow/test';
import { beforeEach,afterEach,expect,test,vi } from 'vitest';
import schema from './schema';
import { api,internal } from './_generated/api';
import { writeProject } from './lib/project_data';
import type { EffectPlan } from '../lib/ai/edit-plan';
const modules=import.meta.glob('./**/*.ts');
beforeEach(()=>{vi.useFakeTimers();vi.stubEnv('RENDER_WORKER_SECRET','test-worker');vi.stubEnv('BILLING_ENABLED','false');});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
async function fixture(){
  const t=convexTest(schema,modules);workflowTest.register(t);const owner=t.withIdentity({subject:'owner'});
  const projectId=await owner.mutation(api.projects.create,{title:'Review fixture',aspectRatio:'landscape'});
  const clip={id:'title',kind:'graphic' as const,text:'Synthetic words',animation:'none' as const,start:0,duration:3,sourceStart:0};
  const timeline={fps:30,aspectRatio:'landscape' as const,clips:[clip,{id:'fx',kind:'effect' as const,effectPreset:'punch' as const,start:1,duration:.4,sourceStart:0}]};
  await t.run(ctx=>writeProject(ctx,projectId,{aiRunning:true,aiRunId:'run',timeline,revision:1}));
  const run={projectId,ownerId:'owner',runId:'run'};
  const plan:EffectPlan={id:'hit',kind:'timed',effect:'punch',start:1,duration:.4,peak:1.2,purpose:'Emphasize a hit',strength:'Fixed 1.2× preset',expectation:'A small push then return',anchor:{kind:'requested-time',time:1.2,description:'Explicit timing'}};
  await t.mutation(internal.compositionReview.savePlan,{...run,plans:[plan],originals:[]});
  const request=()=>t.mutation(internal.compositionReview.request,{...run,expectedRevision:1,timeline,planIds:['hit'],bindings:[{planId:'hit',clipId:'fx'}]});
  return {t,owner,projectId,run,timeline,plan,request};
}
test('review snapshots are owned/revision-checked, old consumers skip them, and new consumers receive a real reference',async()=>{
  const f=await fixture(),reviewId=await f.request();
  await f.t.finishAllScheduledFunctions(vi.runAllTimers);
  await f.t.run(ctx=>ctx.db.patch(reviewId,{createdAt:Date.now()}));
  expect(await f.t.mutation(api.mediaTasks.claim,{workerSecret:'test-worker'})).toBeNull();
  const lease=(await f.t.mutation(api.mediaTasks.claim,{workerSecret:'test-worker',processorVersion:2,compact:true}))!;
  const work=await f.t.query(api.mediaTasks.work,{taskId:lease.taskId,leaseToken:lease.leaseToken});
  expect(work.review?.timeline.clips.map(clip=>clip.id)).toEqual(['title','fx']);expect(work.review?.reference.clips.map(clip=>clip.id)).toEqual(['title']);
  const result={revision:1,sampleTimes:[1,1.2,1.4],checks:[{planId:'hit',timingPass:true,peakPixelChange:.1,pixelPass:null,textSafe:null}],observations:[{planId:'hit',verdict:'unverifiable' as const,evidence:'No impact is visible in the synthetic title.'}],uncertainty:'No audio judgement.'};
  await expect(f.t.mutation(api.mediaTasks.complete,{taskId:lease.taskId,leaseToken:lease.leaseToken,result:{review:{...result,revision:0}}})).rejects.toThrow('snapshot');
  await f.t.mutation(api.mediaTasks.complete,{taskId:lease.taskId,leaseToken:lease.leaseToken,result:{review:result}});
  expect(await f.t.query(internal.compositionReview.get,{...f.run,reviewId})).toMatchObject({status:'completed',result});
  await expect(f.t.query(internal.compositionReview.get,{...f.run,ownerId:'stranger',reviewId})).rejects.toThrow('Project not found');
  await f.t.finishAllScheduledFunctions(vi.runAllTimers);
});
test('one initial review and one fix pass cannot be reset by changing the plan',async()=>{
  const f=await fixture();await f.request();
  await expect(f.t.mutation(internal.compositionReview.savePlan,{...f.run,plans:[f.plan],originals:[]})).rejects.toThrow('original expectations');
  await expect(f.request()).rejects.toThrow('targeted fix');
  await f.t.run(async ctx=>{const prior=(await ctx.db.query('compositionReviews').withIndex('by_project',q=>q.eq('projectId',f.projectId)).first())!;await ctx.db.patch(prior._id,{status:'completed'});});
  f.timeline.clips[1].duration=.5;await f.request();await expect(f.request()).rejects.toThrow('one initial');
  await f.t.run(ctx=>writeProject(ctx,f.projectId,{revision:2}));await expect(f.request()).rejects.toThrow('changed elsewhere');
});
test.each(['second-effect','peak','anchor','return'] as const)('review refuses an uncaptured %s before queuing paid work',async point=>{
  const f=await fixture();f.timeline.clips[0].duration=8;
  const plans:EffectPlan[]=point==='second-effect'?[f.plan,{...f.plan,id:'later',start:5,peak:5.2,anchor:{...f.plan.anchor,time:5.2}}]
    :[{...f.plan,...(point==='peak'?{duration:5,peak:5.2}:point==='anchor'?{anchor:{...f.plan.anchor,time:5.2}}:{checks:{returnBy:5.2}})}];
  if(point==='second-effect')f.timeline.clips.push({...f.timeline.clips[1],id:'later-fx',start:5});
  await f.t.run(ctx=>writeProject(ctx,f.projectId,{timeline:f.timeline}));
  await f.t.mutation(internal.compositionReview.savePlan,{...f.run,plans,originals:[]});
  await expect(f.t.mutation(internal.compositionReview.request,{...f.run,expectedRevision:1,timeline:f.timeline,planIds:plans.map(plan=>plan.id),bindings:plans.map(plan=>({planId:plan.id,clipId:plan.id==='later'?'later-fx':'fx'}))})).rejects.toThrow('outside the rendered review window');
  expect(await f.t.run(ctx=>ctx.db.query('compositionReviews').withIndex('by_project',q=>q.eq('projectId',f.projectId)).take(1))).toEqual([]);
  expect(await f.t.run(ctx=>ctx.db.query('assistantPlans').withIndex('by_project',q=>q.eq('projectId',f.projectId)).unique())).toMatchObject({reviews:0});
});
test('a long look can still be sampled when its declared peak and anchor are covered',async()=>{
  const f=await fixture();f.timeline.clips[0].duration=8;
  const plan:EffectPlan={...f.plan,kind:'text',effect:'appearance',targetClipId:'title',start:0,duration:8,peak:1,anchor:{...f.plan.anchor,time:1}};
  await f.t.run(ctx=>writeProject(ctx,f.projectId,{timeline:f.timeline}));
  await f.t.mutation(internal.compositionReview.savePlan,{...f.run,plans:[plan],originals:[f.timeline.clips[0]]});
  const reviewId=await f.t.mutation(internal.compositionReview.request,{...f.run,expectedRevision:1,timeline:f.timeline,planIds:[plan.id],bindings:[{planId:plan.id,clipId:'title'}]});
  expect(await f.t.run(ctx=>ctx.db.get(reviewId))).toMatchObject({start:0,end:3});
});
test('stopped or superseded runs never enter paid composition review processing',async()=>{
  const f=await fixture();await f.request();await f.t.finishAllScheduledFunctions(vi.runAllTimers);
  await f.t.run(ctx=>writeProject(ctx,f.projectId,{aiRunId:'new-run'}));
  expect(await f.t.mutation(api.mediaTasks.claim,{workerSecret:'test-worker',processorVersion:2})).toBeNull();
  expect((await f.owner.query(api.mediaTasks.list,{projectId:f.projectId}))[0].status).toBe('cancelled');
});
