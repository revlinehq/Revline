/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import agentTest from '@convex-dev/agent/test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

beforeEach(() => { vi.stubEnv('BILLING_ENABLED','false'); vi.stubEnv('ANTHROPIC_API_KEY','fixture-only'); vi.stubEnv('AI_GATEWAY_ENABLED','false'); vi.stubEnv('CLAUDE_MODEL','claude-sonnet-5-5'); });
afterEach(() => vi.unstubAllEnvs());
async function fixture() {
  const t=convexTest(schema,import.meta.glob('./**/*.ts')); agentTest.register(t);
  const owner=t.withIdentity({subject:'owner'});
  const projectId=await owner.mutation(api.projects.create,{title:'Recovery fixture',aspectRatio:'landscape'});
  const read=()=>t.run(ctx=>ctx.db.get(projectId));
  const send=(prompt:string)=>owner.mutation(api.assistant.send,{projectId,prompt});
  return {t,owner,projectId,read,send};
}

test('failed run retains its request and saved revision, and a rephrased follow-up receives that recovery',async()=>{
  const f=await fixture(); await f.send('Make a hype edit ending on the reaction');
  const run=await f.read();
  await f.t.mutation(internal.assistant.apply,{projectId:f.projectId,ownerId:'owner',runId:run!.aiRunId!,expectedRevision:0,timeline:{fps:30,aspectRatio:'landscape',clips:[{id:'text',kind:'caption',track:1,start:0,duration:2,sourceStart:0,text:'Saved'}]}});
  await f.t.mutation(internal.assistant.finish,{projectId:f.projectId,ownerId:'owner',runId:run!.aiRunId!,error:'Token safety stop',savedEdits:1});
  expect(await f.read()).toMatchObject({revision:1,aiRecovery:{requests:['Make a hype edit ending on the reaction'],revision:1,savedEdits:1,status:'failed'},timeline:{clips:[expect.objectContaining({text:'Saved'})]}});
  await f.send('Finish the ending softly');
  const scheduled=await f.t.run(ctx=>ctx.db.system.query('_scheduled_functions').collect());
  expect(scheduled.at(-1)?.args[0].recovery).toMatchObject({requests:['Make a hype edit ending on the reaction'],savedEdits:1,revision:1});
  expect((await f.read())?.aiRequest?.prompt).toBe('Finish the ending softly');
});

test('stopping retains facts, a late old callback cannot stop the new run, and success clears recovery',async()=>{
  const f=await fixture(); await f.send('Add a title'); const old=await f.read();
  await f.owner.mutation(api.assistant.stop,{projectId:f.projectId});
  expect((await f.read())?.aiRecovery).toMatchObject({requests:['Add a title'],status:'stopped'});
  await f.send('Use smaller text'); const current=await f.read();
  await f.t.mutation(internal.assistant.finish,{projectId:f.projectId,ownerId:'owner',runId:old!.aiRunId!,error:'Late old failure'});
  expect(await f.read()).toMatchObject({aiRunning:true,aiRunId:current!.aiRunId,aiRequest:{prompt:'Use smaller text'}});
  await f.t.mutation(internal.assistant.finish,{projectId:f.projectId,ownerId:'owner',runId:current!.aiRunId!});
  expect((await f.read())?.aiRecovery).toBeUndefined(); expect((await f.read())?.aiRequest).toBeUndefined();
});

test('repeated failures bound follow-ups but retain the original goal; legacy errors do not invent one',async()=>{
  const f=await fixture();
  await f.t.run(ctx=>ctx.db.patch(f.projectId,{aiError:'Old timeout'}));
  await f.send('Original goal'); expect((await f.read())?.aiRecovery?.requests).toEqual([]);
  for(const prompt of ['Original goal','follow-up one','follow-up two','follow-up three','follow-up four']) {
    const run=await f.read();
    await f.t.mutation(internal.assistant.finish,{projectId:f.projectId,ownerId:'owner',runId:run!.aiRunId!,error:'Interrupted'});
    if(prompt==='follow-up four')break;
    const next=prompt==='Original goal'?'follow-up one':prompt==='follow-up one'?'follow-up two':prompt==='follow-up two'?'follow-up three':'follow-up four';
    await f.send(next);
  }
  expect((await f.read())?.aiRecovery?.requests).toEqual(['Original goal','follow-up two','follow-up three','follow-up four']);
});
