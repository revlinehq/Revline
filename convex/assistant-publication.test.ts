import { writeProject } from './lib/project_data';
/// <reference types="vite/client" />
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {convexTest} from 'convex-test';
import agentTest from '@convex-dev/agent/test';
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

test('failure receipt marks only the discarded staged revision and keeps earlier immediate checkpoints saved',async()=>{
  const x=await setup();
  const immediatelySaved={...original,clips:original.clips.map(c=>({...c,fontSize:80}))};
  await x.session.checkpoint(()=>immediatelySaved);
  await x.session.checkpoint(t=>({...t,clips:[]}));
  await expect(x.session.complete('length')).rejects.toThrow('not saved');
  await x.t.mutation(internal.assistant.finish,{...x.run,error:'Not saved',publication:{...x.publication,stagedRevision:x.session.revision,status:'failed'}});
  expect(await x.read()).toMatchObject({revision:1,history:[original],timeline:immediatelySaved,aiRunning:false});
  expect((await x.receipts()).map(item=>item.receipt)).toEqual([{version:1,kind:'timeline-publication',status:'failed',runId:'run',...x.publication,stagedRevision:1}]);
  await x.prompt('A later message');
  await x.t.run(ctx=>writeProject(ctx,x.projectId,{aiRunId:'later',aiError:undefined}));
  expect((await x.receipts())[0].receipt.status).toBe('failed');
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
