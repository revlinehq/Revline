import { writeProject } from './lib/project_data';
/// <reference types="vite/client" />
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {convexTest} from 'convex-test';
import agentTest from '@convex-dev/agent/test';
import workflowTest from '@convex-dev/workflow/test';
import {createThread,saveMessages} from '@convex-dev/agent';
import {api,components,internal} from './_generated/api';
import schema from './schema';
import {EditSession} from './lib/editSession';
import type {Timeline} from '../lib/editor/types';
import type {TimelinePublicationReceipt} from '../lib/ai/publication-receipt';

beforeEach(()=>vi.stubEnv('BILLING_ENABLED','false'));
afterEach(()=>vi.unstubAllEnvs());
const original:Timeline={fps:30,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:0,effects:0},clips:[{id:'caption',kind:'caption',text:'Keep the words',track:1,start:0,duration:3,sourceStart:0}]};

async function setup(){
  const t=convexTest(schema,import.meta.glob('./**/*.ts'));agentTest.register(t);
  const owner=t.withIdentity({subject:'owner'});
  const projectId=await owner.mutation(api.projects.create,{title:'Publication fixture',aspectRatio:'landscape'});
  const threadId=await t.run(ctx=>createThread(ctx,components.agent,{userId:'owner'}));
  const prompt=async(content:string,thread=threadId)=>t.run(async ctx=>(await saveMessages(ctx,components.agent,{threadId:thread,userId:'owner',messages:[{role:'user',content}]})).messages[0]._id);
  const promptMessageId=await prompt('Delete the caption');
  await t.run(ctx=>writeProject(ctx,projectId,{threadId,timeline:original,revision:0,history:[],aiRunning:true,aiRunId:'run',aiUndoRecorded:false}));
  const run={projectId,ownerId:'owner',runId:'run'},publication={threadId,promptMessageId};
  const read=()=>owner.query(api.projects.get,{projectId});
  const page=()=>owner.query(api.assistant.messages,{projectId,threadId,paginationOpts:{cursor:null,numItems:50}});
  const receipts=async()=>{
    const result=await page();
    return result.page.flatMap(message=>message.parts.flatMap(part=>{
      if(part.type!=='text')return [];
      const receipt=part.providerMetadata?.revline?.publicationReceipt as TimelinePublicationReceipt|undefined;
      return receipt?[{receipt,message}]:[];
    }));
  };
  const session=new EditSession(original,0,{
    apply:(timeline,expectedRevision,publish)=>t.mutation(internal.assistant.apply,{...run,timeline,expectedRevision,...(publish?{publication}:{})}),
    validate:(timeline,expectedRevision)=>t.query(internal.assistant.validateDraft,{...run,timeline,expectedRevision}),
  });
  return{t,owner,projectId,threadId,promptMessageId,prompt,run,publication,read,page,receipts,session};
}

test('final staged publication and SDK receipt commit together, survive a later turn/reload and retain one undo group',async()=>{
  const x=await setup();
  await x.session.checkpoint(t=>({...t,clips:[]}));
  expect(await x.receipts()).toEqual([]);expect((await x.read()).timeline).toEqual(original);
  await x.session.complete('stop');
  const [{receipt,message}]=await x.receipts();
  expect(receipt).toEqual({version:1,kind:'timeline-publication',status:'saved',runId:'run',...x.publication,stagedRevision:0,revision:1});
  const user=(await x.page()).page.find(m=>m.role==='user')!;
  expect(user.id).toBe(x.promptMessageId);expect(message.order).toBe(user.order);expect(message.stepOrder).toBeGreaterThan(user.stepOrder);
  expect(await x.read()).toMatchObject({revision:1,history:[original],timeline:{clips:[]}});
  await x.t.mutation(internal.assistant.finish,x.run);
  await x.prompt('Thanks');
  await x.t.run(ctx=>writeProject(ctx,x.projectId,{aiRunning:true,aiRunId:'new-run',aiCheckpointRevision:undefined,aiUndoRecorded:false}));
  expect((await x.receipts()).map(item=>item.receipt)).toEqual([receipt]);
  await x.owner.mutation(api.projects.undo,{projectId:x.projectId});
  expect((await x.read()).timeline).toEqual(original);
});

test('missing receipt prompt rolls back the timeline, revision and undo history in the same transaction',async()=>{
  const x=await setup();
  const missing=await x.prompt('Removed prompt');
  await x.t.run(ctx=>ctx.runMutation(components.agent.messages.deleteByIds,{messageIds:[missing]}));
  await expect(x.t.mutation(internal.assistant.apply,{...x.run,expectedRevision:0,timeline:{...original,clips:[]},publication:{...x.publication,promptMessageId:missing}})).rejects.toThrow('Publication prompt');
  expect(await x.read()).toMatchObject({revision:0,history:[],timeline:original,aiUndoRecorded:false});expect(await x.receipts()).toEqual([]);
});

test('output limit publishes the valid partial draft with a receipt and preserves one undo group',async()=>{
  const x=await setup();
  const immediatelySaved={...original,clips:original.clips.map(c=>({...c,fontSize:80}))};
  await x.session.checkpoint(()=>immediatelySaved);
  await x.session.checkpoint(t=>({...t,clips:[]}));
  await expect(x.session.complete('length')).rejects.toThrow('Your saved changes remain');
  await x.t.mutation(internal.assistant.finish,{...x.run,error:'The request reached the model output limit.',savedEdits:x.session.savedEdits});
  expect(await x.read()).toMatchObject({revision:2,history:[original],timeline:{clips:[]},aiRunning:false});
  expect((await x.receipts()).map(item=>item.receipt)).toEqual([{version:1,kind:'timeline-publication',status:'saved',runId:'run',...x.publication,stagedRevision:1,revision:2}]);
  await x.prompt('A later message');
  await x.t.run(ctx=>writeProject(ctx,x.projectId,{aiRunId:'later',aiError:undefined}));
  expect((await x.receipts())[0].receipt.status).toBe('saved');
});

test('an aborted old run retains its prompt receipt without stopping or overwriting a newer run',async()=>{
  const x=await setup();await x.session.checkpoint(t=>({...t,clips:[]}));
  await x.owner.mutation(api.assistant.stop,{projectId:x.projectId});
  const nextPrompt=await x.prompt('New request');
  await x.t.run(ctx=>writeProject(ctx,x.projectId,{aiRunning:true,aiRunId:'new-run',aiError:'New run state'}));
  await x.t.mutation(internal.assistant.finish,{...x.run,publication:{...x.publication,stagedRevision:0,status:'aborted'}});
  expect(await x.read()).toMatchObject({revision:0,history:[],timeline:original,aiRunning:true,aiRunId:'new-run',aiError:'New run state'});
  const [saved]=await x.receipts();expect(saved.receipt).toMatchObject({status:'aborted',promptMessageId:x.promptMessageId,runId:'run'});
  expect(saved.receipt.promptMessageId).not.toBe(nextPrompt);
});

test('publication refuses wrong owner/run/revision/conversation and prompt from a different conversation',async()=>{
  const x=await setup(),args={...x.run,expectedRevision:0,timeline:{...original,clips:[]},publication:x.publication};
  await expect(x.t.mutation(internal.assistant.apply,{...args,ownerId:'other'})).rejects.toThrow();
  await expect(x.t.mutation(internal.assistant.apply,{...args,runId:'old'})).rejects.toThrow('no longer active');
  await expect(x.t.mutation(internal.assistant.apply,{...args,expectedRevision:1})).rejects.toThrow('changed elsewhere');
  await expect(x.t.mutation(internal.assistant.apply,{...args,publication:{...x.publication,threadId:'wrong'}})).rejects.toThrow('conversation');
  const foreign=await x.t.run(ctx=>createThread(ctx,components.agent,{userId:'owner'}));
  const foreignPrompt=await x.prompt('Foreign prompt',foreign);
  await expect(x.t.mutation(internal.assistant.apply,{...args,publication:{...x.publication,promptMessageId:foreignPrompt}})).rejects.toThrow('prompt');
  expect(await x.read()).toMatchObject({revision:0,history:[],timeline:original});expect(await x.receipts()).toEqual([]);
});

test('live draft is owner-only, validates sources and never changes the saved timeline or undo history',async()=>{
  const x=await setup();
  const next={...original,clips:original.clips.map(clip=>({...clip,start:1}))};
  await x.t.mutation(internal.assistant.previewDraft,{...x.run,expectedRevision:0,timeline:next});
  expect(await x.owner.query(api.assistant.livePreview,{projectId:x.projectId})).toMatchObject({timeline:next,sequence:1,baseRevision:0,label:'Moving clips',changedClipIds:['caption']});
  expect(await x.read()).toMatchObject({revision:0,timeline:original,history:[]});
  await expect(x.t.withIdentity({subject:'other'}).query(api.assistant.livePreview,{projectId:x.projectId})).rejects.toThrow('Project not found');
  await expect(x.t.mutation(internal.assistant.previewDraft,{...x.run,expectedRevision:0,timeline:{...next,clips:[{...next.clips[0],duration:-1}]}})).rejects.toThrow();
  expect(await x.owner.query(api.assistant.livePreview,{projectId:x.projectId})).toMatchObject({timeline:next,sequence:1});
  await x.t.mutation(internal.assistant.previewDraft,{...x.run,expectedRevision:0,timeline:next});
  expect(await x.owner.query(api.assistant.livePreview,{projectId:x.projectId})).toMatchObject({sequence:1});
});

test('stopping a live draft restores saved state and rejects late changes from that run',async()=>{
  const x=await setup();
  await x.t.mutation(internal.assistant.previewDraft,{...x.run,expectedRevision:0,timeline:{...original,clips:[]}});
  await x.owner.mutation(api.assistant.stop,{projectId:x.projectId});
  expect(await x.owner.query(api.assistant.livePreview,{projectId:x.projectId})).toBeNull();
  expect(await x.read()).toMatchObject({timeline:original,revision:0,history:[]});
  await expect(x.t.mutation(internal.assistant.previewDraft,{...x.run,expectedRevision:0,timeline:original})).rejects.toThrow('no longer active');
});

test('a stale preview is hidden after a revision change and a published edit remains undoable',async()=>{
  const x=await setup();
  const next={...original,clips:original.clips.map(clip=>({...clip,start:1}))};
  await x.t.mutation(internal.assistant.previewDraft,{...x.run,expectedRevision:0,timeline:next});
  await x.t.run(ctx=>writeProject(ctx,x.projectId,{revision:1}));
  expect(await x.owner.query(api.assistant.livePreview,{projectId:x.projectId})).toBeNull();
  await expect(x.t.mutation(internal.assistant.previewDraft,{...x.run,expectedRevision:0,timeline:next})).rejects.toThrow('changed elsewhere');
  await x.t.run(ctx=>writeProject(ctx,x.projectId,{revision:0}));
  await x.t.mutation(internal.assistant.apply,{...x.run,expectedRevision:0,timeline:next,publication:x.publication});
  expect(await x.owner.query(api.assistant.livePreview,{projectId:x.projectId})).toMatchObject({baseRevision:1,timeline:next});
  await x.t.mutation(internal.assistant.finish,x.run);
  expect(await x.owner.query(api.assistant.livePreview,{projectId:x.projectId})).toBeNull();
  await x.owner.mutation(api.projects.undo,{projectId:x.projectId});
  expect((await x.read()).timeline).toEqual(original);
});

test('finishing footage analysis keeps tracks locked through planning until the run finishes',async()=>{
  const x=await setup();workflowTest.register(x.t);
  const assetId=await x.t.run(ctx=>ctx.db.insert('assets',{ownerId:'owner',projectId:x.projectId,kind:'video',fileName:'Source.mp4',contentType:'video/mp4',size:1,duration:10,createdAt:Date.now()}));
  const requestId=await x.t.mutation(internal.assistant.requestAnalysis,{...x.run,assetId,mode:'understand'});
  expect((await x.owner.query(api.assistant.status,{projectId:x.projectId})).workflowActive).toBe(true);
  await x.t.mutation(internal.assistant.clearAnalysis,{...x.run,requestId});
  expect((await x.owner.query(api.assistant.status,{projectId:x.projectId})).workflowActive).toBe(true);
  expect((await x.read()).timeline).toEqual(original);
  await expect(x.owner.mutation(api.projects.saveTimeline,{projectId:x.projectId,expectedRevision:0,timeline:{...original,clips:original.clips.map(clip=>({...clip,duration:2}))}})).rejects.toThrow();
  await x.t.mutation(internal.assistant.finish,x.run);
  expect((await x.owner.query(api.assistant.status,{projectId:x.projectId})).workflowActive).toBe(false);
});

test('analysis capacity survives clearing completed requests and continuing the original run',async()=>{
  const x=await setup();workflowTest.register(x.t);
  const assetId=await x.t.run(ctx=>ctx.db.insert('assets',{ownerId:'owner',projectId:x.projectId,kind:'video',fileName:'Source.mp4',contentType:'video/mp4',size:1,duration:10,createdAt:Date.now()}));
  const request=(index:number)=>x.t.mutation(internal.assistant.requestAnalysis,{...x.run,assetId,mode:'frames',frameRequest:{start:0,end:1,question:`Inspect distinct detail ${index}`}});
  for(let index=0;index<15;index++){
    const requestId=await request(index);
    await x.t.run(async ctx=>{const row=await ctx.db.get(requestId);await ctx.db.patch(row!.taskId!,{status:'completed'});await ctx.db.patch(requestId,{status:'completed'});});
    await x.t.mutation(internal.assistant.clearAnalysis,{...x.run,requestId});
  }
  expect(await x.t.run(ctx=>ctx.db.query('analysisRequests').withIndex('by_projectId_runId',q=>q.eq('projectId',x.projectId).eq('aiRunId',x.run.runId)).collect())).toEqual([]);
  // Durable segments keep this exact run ID and may update other run state.
  await x.t.run(ctx=>writeProject(ctx,x.projectId,{aiEditing:true}));
  await expect(request(15)).rejects.toThrow('Too many analysis requests');
  expect((await x.read()).aiAnalysisUsage).toEqual({runId:'run',enqueued:15});
  expect(await x.t.run(ctx=>ctx.db.query('mediaTasks').withIndex('by_asset_kind',q=>q.eq('assetId',assetId).eq('kind','frames')).collect())).toHaveLength(15);
  vi.stubEnv('OPENAI_API_KEY','fixture-only');
  await x.t.mutation(internal.assistant.finish,x.run);
  await x.owner.mutation(api.assistant.send,{projectId:x.projectId,prompt:'Inspect the next detail'});
  const next=await x.read();expect(next.aiRunId).not.toBe('run');expect(next.aiAnalysisUsage).toEqual({runId:next.aiRunId,enqueued:0});
  await x.t.mutation(internal.assistant.requestAnalysis,{...x.run,runId:next.aiRunId!,assetId,mode:'frames',frameRequest:{start:0,end:1,question:'New run detail'}});
  expect((await x.read()).aiAnalysisUsage).toEqual({runId:next.aiRunId,enqueued:1});
});

test('saved analysis and active task reuse remain available when the original run reaches capacity',async()=>{
  const x=await setup();workflowTest.register(x.t);
  const assetId=await x.t.run(ctx=>ctx.db.insert('assets',{ownerId:'owner',projectId:x.projectId,kind:'video',fileName:'Source.mp4',contentType:'video/mp4',size:1,duration:10,createdAt:Date.now()}));
  const frameRequest={start:0,end:1,question:'Cached source detail'};
  const cachedTask=await x.t.run(async ctx=>{
    await writeProject(ctx,x.projectId,{aiAnalysisUsage:{runId:'run',enqueued:15}});
    return ctx.db.insert('mediaTasks',{ownerId:'owner',projectId:x.projectId,assetId,kind:'frames',frameRequest,requiredProcessorVersion:4,status:'completed',attempt:1,progress:100,createdAt:Date.now(),updatedAt:Date.now(),frameInspection:{...frameRequest,geometry:{sourceWidth:1920,sourceHeight:1080,decodedWidth:960,decodedHeight:540},sourceFps:30,sampleInterval:1,consecutive:false,summary:'Saved observation',uncertainty:'',frames:[{frameIndex:0,time:0,observation:'Visible detail'}],events:[]}});
  });
  const cachedRequest=await x.t.mutation(internal.assistant.requestAnalysis,{...x.run,assetId,mode:'frames',frameRequest});
  expect(await x.t.run(ctx=>ctx.db.get(cachedRequest))).toMatchObject({status:'completed',taskId:cachedTask});
  await x.t.mutation(internal.assistant.clearAnalysis,{...x.run,requestId:cachedRequest});
  const activeTask=await x.t.run(ctx=>ctx.db.insert('mediaTasks',{ownerId:'owner',projectId:x.projectId,assetId,kind:'transcribe',status:'queued',attempt:0,progress:0,createdAt:Date.now(),updatedAt:Date.now()}));
  const activeRequest=await x.t.mutation(internal.assistant.requestAnalysis,{...x.run,assetId,mode:'transcribe'});
  expect(await x.t.run(ctx=>ctx.db.get(activeRequest))).toMatchObject({taskId:activeTask});
  const pendingFrames={...frameRequest,question:'Already queued detail'};
  const activeFramesTask=await x.t.run(ctx=>ctx.db.insert('mediaTasks',{ownerId:'owner',projectId:x.projectId,assetId,kind:'frames',frameRequest:pendingFrames,requiredProcessorVersion:4,status:'queued',attempt:0,progress:0,createdAt:Date.now(),updatedAt:Date.now()}));
  const frameArgs={...x.run,assetId,mode:'frames' as const,frameRequest:pendingFrames};
  const activeFramesRequest=await x.t.mutation(internal.assistant.requestAnalysis,frameArgs);
  expect(await x.t.run(ctx=>ctx.db.get(activeFramesRequest))).toMatchObject({taskId:activeFramesTask});
  expect(await x.t.mutation(internal.assistant.requestAnalysis,frameArgs)).toBe(activeFramesRequest);
  expect((await x.read()).aiAnalysisUsage).toEqual({runId:'run',enqueued:15});
  const before=await x.t.run(ctx=>ctx.db.query('analysisRequests').withIndex('by_projectId_runId',q=>q.eq('projectId',x.projectId).eq('aiRunId','run')).collect());
  await expect(x.t.mutation(internal.assistant.requestAnalysis,{...x.run,assetId,mode:'frames',frameRequest:{...frameRequest,question:'Uncached detail'}})).rejects.toThrow('Too many analysis requests');
  expect(await x.t.run(ctx=>ctx.db.query('analysisRequests').withIndex('by_projectId_runId',q=>q.eq('projectId',x.projectId).eq('aiRunId','run')).collect())).toEqual(before);
});

test('answering a follow-up question preserves the unfinished edit for a later continue button',async()=>{
  const x=await setup();
  const recovery={requests:['Trim pauses and add subtitles'],runId:'previous-run',revision:0,savedEdits:1,status:'failed' as const,reason:'Time limit',updatedAt:Date.now()};
  await x.t.run(ctx=>writeProject(ctx,x.projectId,{aiRecovery:recovery,aiEditing:false,aiUndoRecorded:false}));
  await x.t.mutation(internal.assistant.finish,x.run);
  expect((await x.read()).aiRecovery).toEqual(recovery);
  await x.t.run(ctx=>writeProject(ctx,x.projectId,{aiRunning:true,aiEditing:true,aiRunId:'run'}));
  await x.t.mutation(internal.assistant.finish,x.run);
  expect((await x.read()).aiRecovery).toEqual(recovery);
  await x.t.run(ctx=>writeProject(ctx,x.projectId,{aiRunning:true,aiEditing:true,aiUndoRecorded:true,aiRunId:'run'}));
  await x.t.mutation(internal.assistant.finish,x.run);
  expect((await x.read()).aiRecovery).toBeUndefined();
});

test.each([
  {verdict:'pass' as const,revision:0,runId:'run',cleared:true},
  {verdict:'fail' as const,revision:0,runId:'run',cleared:false},
  {verdict:'unverifiable' as const,revision:0,runId:'run',cleared:false},
  {verdict:'pass' as const,revision:1,runId:'run',cleared:false},
  {verdict:'pass' as const,revision:0,runId:'previous-run',cleared:false},
])('verification-only recovery clears only after current passed receipts: $verdict/$revision/$runId',async({verdict,revision,runId,cleared})=>{
  const x=await setup();
  const recovery={requests:['Finish the visual check'],runId:'previous-run',revision:0,savedEdits:1,status:'failed' as const,reason:'Time limit',updatedAt:Date.now()};
  await x.t.run(async ctx=>{
    await writeProject(ctx,x.projectId,{aiRecovery:recovery,aiUndoRecorded:false});
    await ctx.db.insert('compositionReviews',{projectId:x.projectId,ownerId:'owner',runId,revision,timeline:original,reference:original,plans:[],assetIds:[],start:0,end:3,status:'completed',createdAt:Date.now(),result:{revision,sampleTimes:[1],checks:[{planId:'title',timingPass:true,peakPixelChange:.1,pixelPass:true,textSafe:true}],observations:[{planId:'title',verdict,evidence:'Captured frame'}],uncertainty:''}});
  });
  await x.t.mutation(internal.assistant.finish,x.run);
  expect((await x.read()).aiRecovery).toEqual(cleared?undefined:recovery);
  expect((await x.read()).timeline).toEqual(original);
});


test('queued messages survive reload, respect ownership and start in order after the active request',async()=>{
  const x=await setup();workflowTest.register(x.t);
  vi.stubEnv('OPENAI_API_KEY','fixture-only');vi.stubEnv('EDITOR_DEFAULT_MODEL','gpt-6.1-sol');vi.stubEnv('AI_GATEWAY_ENABLED','false');
  await x.owner.mutation(api.assistant.send,{projectId:x.projectId,prompt:'First queued request'});
  await x.owner.mutation(api.assistant.send,{projectId:x.projectId,prompt:'Second queued request'});
  const queue=await x.owner.query(api.assistant.queued,{projectId:x.projectId});
  expect(queue.messages.map(row=>row.prompt)).toEqual(['First queued request','Second queued request']);
  expect((await x.read()).aiRunId).toBe('run');
  const stranger=x.t.withIdentity({subject:'stranger'});
  await expect(stranger.query(api.assistant.queued,{projectId:x.projectId})).rejects.toThrow();
  await expect(stranger.mutation(api.assistant.removeQueued,{projectId:x.projectId,id:queue.messages[0].id})).rejects.toThrow();
  await x.t.mutation(internal.assistant.finish,x.run);
  await x.t.mutation(internal.assistant.drainQueue,{projectId:x.projectId,ownerId:'owner'});
  const started=await x.read();
  expect(started.aiRequest?.prompt).toBe('First queued request');
  expect(started.aiWorkflowId).toBeTruthy();
  expect((await x.owner.query(api.assistant.queued,{projectId:x.projectId})).messages.map(row=>row.prompt)).toEqual(['Second queued request']);
  await x.owner.mutation(api.assistant.stop,{projectId:x.projectId});
  expect((await x.owner.query(api.assistant.queued,{projectId:x.projectId})).paused).toBe(true);
  await x.t.mutation(internal.assistant.drainQueue,{projectId:x.projectId,ownerId:'owner'});
  expect((await x.read()).aiRunning).toBe(false);
  await x.owner.mutation(api.assistant.resumeQueue,{projectId:x.projectId});
  await x.t.mutation(internal.assistant.drainQueue,{projectId:x.projectId,ownerId:'owner'});
  expect((await x.read()).aiRequest?.prompt).toBe('Second queued request');
  expect((await x.owner.query(api.assistant.queued,{projectId:x.projectId})).messages).toEqual([]);
  await x.owner.mutation(api.assistant.stop,{projectId:x.projectId});
});

test('queued requests can be removed and the queue has a bounded size',async()=>{
  const x=await setup();vi.stubEnv('OPENAI_API_KEY','fixture-only');vi.stubEnv('EDITOR_DEFAULT_MODEL','gpt-6.1-sol');vi.stubEnv('AI_GATEWAY_ENABLED','false');
  for(let i=0;i<10;i++)await x.owner.mutation(api.assistant.send,{projectId:x.projectId,prompt:`Queued ${i}`});
  await expect(x.owner.mutation(api.assistant.send,{projectId:x.projectId,prompt:'Over limit'})).rejects.toThrow('10 messages');
  const queue=await x.owner.query(api.assistant.queued,{projectId:x.projectId});
  await x.owner.mutation(api.assistant.removeQueued,{projectId:x.projectId,id:queue.messages[4].id});
  expect((await x.owner.query(api.assistant.queued,{projectId:x.projectId})).messages.map(row=>row.prompt)).not.toContain('Queued 4');
});

test('AI submissions are rate limited per account by minute and day, and a refusal is not charged',async()=>{
  const x=await setup();vi.stubEnv('OPENAI_API_KEY','fixture-only');vi.stubEnv('EDITOR_DEFAULT_MODEL','gpt-6.1-sol');vi.stubEnv('AI_GATEWAY_ENABLED','false');
  vi.stubEnv('AI_REQUESTS_PER_MINUTE_PER_ACCOUNT','2');vi.stubEnv('AI_REQUESTS_PER_DAY_PER_ACCOUNT','3');
  // Ten seconds into a minute at midday UTC near real time: away from both resets.
  const now=Date.now(),start=now-now%86_400_000+43_210_000,time=vi.spyOn(Date,'now').mockReturnValue(start);
  try{
    const send=(prompt:string)=>x.owner.mutation(api.assistant.send,{projectId:x.projectId,prompt});
    await send('One');await send('Two');
    await expect(send('Too fast')).rejects.toThrow('too quickly');
    time.mockReturnValue(start+60_000);await send('Three');
    time.mockReturnValue(start+120_000);await expect(send('Over the day')).rejects.toThrow("today's limit of 3 AI requests");
    expect((await x.owner.query(api.assistant.queued,{projectId:x.projectId})).messages.map(row=>row.prompt)).toEqual(['One','Two','Three']);
    time.mockReturnValue(start+86_400_000);await expect(send('Tomorrow')).resolves.toBeNull();
  }finally{time.mockRestore();}
});
