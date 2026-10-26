import { getFunctionName } from 'convex/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ generate: undefined as undefined | ((tools: Record<string, { execute: (ctx: unknown, input: unknown) => Promise<unknown> }>) => Promise<void>), events: [] as string[] }));
vi.mock('@convex-dev/agent', async original => ({ ...await original<Record<string, unknown>>(), createTool: (options: unknown) => options, saveMessage: async () => null,
  Agent: class {
    constructor(_component: unknown, private options: { tools: Parameters<NonNullable<typeof fixture.generate>>[0] }) {}
    async streamText() { await fixture.generate!(this.options.tools); return { finishReason: Promise.resolve('stop'), steps: Promise.resolve([]) }; }
  },
}));
import { respond } from './assistantActions';
beforeEach(() => { vi.stubEnv('OPENAI_API_KEY', 'fixture-only'); vi.stubEnv('EDITOR_ENFORCE_TOKEN_BUDGET', 'false'); vi.stubEnv('MODEL_SWITCHER_ENABLED', 'false'); vi.stubEnv('AI_COST_DASHBOARD_ENABLED', 'false'); fixture.events = []; });
afterEach(() => vi.unstubAllEnvs());
async function run() {
  const ctx = {
    runQuery: async (ref: Parameters<typeof getFunctionName>[0]) => {
      switch (getFunctionName(ref)) {
        case 'assistant:currentPrompt': return 'Round the footage corners.';
        case 'assistant:getRun': return { project: { timeline: { fps: 30, aspectRatio: 'landscape', clips: [] }, revision: 67 }, assets: [] };
        case 'assistant:isRunActive': return true;
        case 'compositionReview:completionState': return {plans:[],validReviews:[]};
        default: throw new Error('Unexpected fixture query');
      }
    },
    runMutation: async (ref: Parameters<typeof getFunctionName>[0]) => { fixture.events.push(getFunctionName(ref)); return null; },
  };
  await (respond as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler(ctx, { projectId: 'project', ownerId: 'owner', runId: 'run', threadId: 'thread', promptMessageId: 'prompt', pinnedModel: { provider: 'openai', modelId: 'gpt-6.1-sol', modelChoice: 'gpt-6.1-sol' } });
}
const plan = { id: 'round', kind: 'visual', effect: 'frameCorners', purpose: 'Round the footage corners', strength: '6% corner radius', expectation: 'Rounded corners expose the background', start: 0, duration: 1, anchor: { kind: 'requested-time' as const, time: 0, description: 'Requested edit' } };
test('explicit creative planning acquires the workflow lock before validation and retains it across correction', async () => {
  fixture.generate = async tools => {
    await expect(tools.planEffects.execute({}, { plans: [{ ...plan, targetClipId: 'missing' }] })).rejects.toThrow('target');
    expect(fixture.events).toContain('assistant:beginEditing');
    expect(fixture.events).not.toContain('compositionReview:savePlan');
    await tools.planEffects.execute({}, { plans: [plan] });
    expect(fixture.events.indexOf('assistant:beginEditing')).toBeLessThan(fixture.events.indexOf('compositionReview:savePlan'));
  };
  await run();
  expect(fixture.events.filter(event => event === 'assistant:beginEditing')).toHaveLength(1);
});
test('a plain answer or read-only timeline question does not acquire an editing lock', async () => {
  fixture.generate = async tools => { await tools.inspectTimeline.execute({}, {}); };
  await run();
  expect(fixture.events).not.toContain('assistant:beginEditing');
});


test('review budget covers separate required plans while bounding each repair and infrastructure attempts', async () => {
  const {compositionReviewBudget,MAX_COMPOSITION_REVIEW_ATTEMPTS}=await import('../lib/ai/composition-review');
  const completed=(...planIds:string[])=>({status:'completed' as const,planIds});
  const firstPass=[completed('a','b'),completed('c','d'),completed('e','f'),completed('g','h')];
  expect(compositionReviewBudget(3,firstPass.slice(0,3),['g','h'])).toBe(3);
  expect(compositionReviewBudget(4,firstPass,['a'])).toBe(4);
  expect(()=>compositionReviewBudget(5,[...firstPass,completed('a')],['a'])).toThrow('review limit');
  expect(()=>compositionReviewBudget(4,[{status:'queued',planIds:['a']}],['b'])).toThrow('Finish');
  expect(compositionReviewBudget(2,[{status:'failed',planIds:['a']},{status:'failed',planIds:['a']}],['a'])).toBe(0);
  expect(()=>compositionReviewBudget(MAX_COMPOSITION_REVIEW_ATTEMPTS,[],['a'])).toThrow('retry limit');
  // A completed judgment for invalidated pixels cannot permanently prevent a
  // fresh check after another overlapping effect is corrected.
  expect(compositionReviewBudget(5,[...firstPass,completed('a')].map(review=>({...review,countedPlanIds:[]})),['a'])).toBe(5);
});

async function persistedReviews(){
  const [{convexTest},{default:schema},{internal},{writeProject}]=await Promise.all([import('convex-test'),import('./schema'),import('./_generated/api'),import('./lib/project_data')]);
  const t=convexTest(schema,import.meta.glob('./**/*.ts'));
  const timeline:import('../lib/editor/types').Timeline={fps:30,aspectRatio:'landscape',tracks:{visual:2,overlay:0,audio:0,effects:0},clips:[{id:'a',kind:'caption',text:'First',start:0,duration:3,sourceStart:0},{id:'b',kind:'caption',text:'Second',start:6,duration:3,sourceStart:0}]};
  const plans:import('../lib/ai/edit-plan').EffectPlan[]=['a','b'].map((id,index)=>({...plan,kind:'text',effect:'appearance',id,targetClipId:id,start:index*6,anchor:{...plan.anchor,time:index*6}}));
  const projectId=await t.run(async ctx=>{
    const id=await ctx.db.insert('projects',{title:'Review continuity',ownerId:'owner',aspectRatio:'landscape',createdAt:Date.now(),updatedAt:Date.now()});
    await writeProject(ctx,id,{timeline,revision:0,aiRunning:true,aiRunId:'run'});
    return id;
  });
  const run={projectId,ownerId:'owner',runId:'run'};
  await t.mutation(internal.compositionReview.savePlan,{...run,plans,originals:timeline.clips});
  const record=async(ids:string[],snapshot=timeline,verdict:'pass'|'fail'|'unverifiable'='pass',runId='run',checks:Partial<{timingPass:boolean;pixelPass:boolean|null;textSafe:boolean|null;returnPass:boolean|null}>={})=>{
    await new Promise(resolve=>setTimeout(resolve,2));
    return t.run(ctx=>ctx.db.insert('compositionReviews',{projectId,ownerId:'owner',runId,revision:0,timeline:snapshot,reference:snapshot,plans:plans.filter(goal=>ids.includes(goal.id)),assetIds:[],start:ids.includes('a')?0:6,end:ids.includes('b')?9:3,status:'completed',createdAt:Date.now(),result:{revision:0,sampleTimes:ids.map(id=>id==='a'?1:7),checks:ids.map(planId=>({planId,timingPass:true,peakPixelChange:.1,pixelPass:true,textSafe:true,...checks})),observations:ids.map(planId=>({planId,verdict,evidence:'Captured frame'})),uncertainty:''}}));
  };
  const state=(snapshot=timeline,expectedRevision=0,ownerId='owner')=>t.query(internal.compositionReview.completionState,{...run,ownerId,timeline:snapshot,expectedRevision});
  return {t,internal,writeProject,projectId,run,timeline,plans,record,state};
}

test('completed review survives checkpoint revision and changes outside its visible window',async()=>{
  const x=await persistedReviews();await x.record(['a']);
  const changed={...x.timeline,clips:x.timeline.clips.map(clip=>clip.id==='b'?{...clip,text:'A different later title'}:clip),markers:[{id:'cue',time:7}],tracks:{visual:4,overlay:0,audio:3}};
  await x.t.run(ctx=>x.writeProject(ctx,x.projectId,{revision:1}));
  const state=await x.state(changed,1);
  expect(state.validReviews).toHaveLength(1);expect(state.validReviews[0]).toMatchObject({planIds:['a'],output:{reviewed:true,stale:false,revision:1,currentRevision:1,observations:[{planId:'a',verdict:'pass'}]}});
  expect(state.plans).toHaveLength(2);
  await expect(x.state(changed,0)).rejects.toThrow('changed elsewhere');
  await expect(x.state(changed,1,'other-owner')).rejects.toThrow();
});

test('visible changes, frame rate, aspect ratio and changed goals invalidate stored review evidence',async()=>{
  const x=await persistedReviews();await x.record(['a']);
  for(const changed of [{...x.timeline,clips:x.timeline.clips.map(clip=>clip.id==='a'?{...clip,color:'#ff0000'}:clip)},{...x.timeline,fps:60},{...x.timeline,aspectRatio:'vertical' as const}])expect((await x.state(changed)).validReviews).toEqual([]);
  await x.t.run(async ctx=>{const saved=await ctx.db.query('assistantPlans').withIndex('by_project',q=>q.eq('projectId',x.projectId)).unique();await ctx.db.patch(saved!._id,{plans:x.plans.map(goal=>goal.id==='a'?{...goal,expectation:'A stricter new goal'}:goal)});});
  expect((await x.state()).validReviews).toEqual([]);
});

test('latest completed judgment per plan wins over an older pass and stays scoped to its run',async()=>{
  const x=await persistedReviews();await x.record(['a']);await x.record(['a'],x.timeline,'unverifiable');await x.record(['b'],x.timeline,'pass','previous-run');
  const state=await x.state();
  expect(state.validReviews).toHaveLength(1);expect(state.validReviews[0].output.observations).toMatchObject([{planId:'a',verdict:'unverifiable'}]);
});

test('targeted visible correction can be reviewed after old judgments without rerendering unchanged evidence',async()=>{
  const x=await persistedReviews();
  const {default:workflowTest}=await import('@convex-dev/workflow/test');workflowTest.register(x.t);workflowTest.register(x.t,'aiWorkflow');
  await x.record(['a'],x.timeline,'fail');await x.record(['a']);
  await x.t.run(async ctx=>{const saved=await ctx.db.query('assistantPlans').withIndex('by_project',q=>q.eq('projectId',x.projectId)).unique();await ctx.db.patch(saved!._id,{reviews:2});});
  await expect(x.t.mutation(x.internal.compositionReview.request,{...x.run,expectedRevision:0,timeline:x.timeline,planIds:['a'],bindings:[]})).rejects.toThrow('review limit');
  const changed={...x.timeline,clips:x.timeline.clips.map(clip=>clip.id==='a'?{...clip,color:'#ff0000'}:clip)};
  const reviewId=await x.t.mutation(x.internal.compositionReview.request,{...x.run,expectedRevision:0,timeline:changed,planIds:['a'],bindings:[]});
  expect(await x.t.run(ctx=>ctx.db.get(reviewId))).toMatchObject({status:'queued',timeline:changed});
});

test.each(['fail','unverifiable'] as const)('two nonpassing judgments cannot be reset by another visible correction: %s',async verdict=>{
  const x=await persistedReviews();await x.record(['a'],x.timeline,'fail');
  const firstFix={...x.timeline,clips:x.timeline.clips.map(clip=>clip.id==='a'?{...clip,color:'#ff0000'}:clip)};
  await x.record(['a'],firstFix,verdict);
  await x.t.run(async ctx=>{const saved=await ctx.db.query('assistantPlans').withIndex('by_project',q=>q.eq('projectId',x.projectId)).unique();await ctx.db.patch(saved!._id,{reviews:2});});
  const secondFix={...x.timeline,clips:x.timeline.clips.map(clip=>clip.id==='a'?{...clip,color:'#0000ff'}:clip)};
  await expect(x.t.mutation(x.internal.compositionReview.request,{...x.run,expectedRevision:0,timeline:secondFix,planIds:['a'],bindings:[]})).rejects.toThrow('two nonpassing judgments');
});

test('passing prose with failed measurements consumes negative quota, while a different goal does not',async()=>{
  const {countedReviewPlanIds}=await import('../lib/ai/composition-review');
  const x=await persistedReviews(),first=await x.record(['a'],x.timeline,'pass','run',{timingPass:false});
  const firstFix={...x.timeline,clips:x.timeline.clips.map(clip=>clip.id==='a'?{...clip,color:'#ff0000'}:clip)};
  await x.record(['a'],firstFix,'pass','run',{pixelPass:false});
  await x.t.run(async ctx=>{const saved=await ctx.db.query('assistantPlans').withIndex('by_project',q=>q.eq('projectId',x.projectId)).unique();await ctx.db.patch(saved!._id,{reviews:2});});
  const secondFix={...x.timeline,clips:x.timeline.clips.map(clip=>clip.id==='a'?{...clip,color:'#0000ff'}:clip)};
  await expect(x.t.mutation(x.internal.compositionReview.request,{...x.run,expectedRevision:0,timeline:secondFix,planIds:['a'],bindings:[]})).rejects.toThrow('two nonpassing judgments');
  const receipt=(await x.t.run(ctx=>ctx.db.get(first)))!;
  expect(countedReviewPlanIds(receipt,secondFix,x.plans)).toEqual(['a']);
  expect(countedReviewPlanIds(receipt,secondFix,x.plans.map(goal=>goal.id==='a'?{...goal,expectation:'A separate normalized goal'}:goal))).toEqual([]);
});

test('visible scope retains held transition dependencies and ignores audio controls',async()=>{
  const {compositionReviewScope,currentReviewPlanIds}=await import('../lib/ai/composition-review');
  const timeline:import('../lib/editor/types').Timeline={fps:30,aspectRatio:'landscape',clips:[{id:'left',kind:'video',start:0,duration:1,sourceStart:0},{id:'right',kind:'video',start:1,duration:1,sourceStart:1},{id:'transition',kind:'effect',start:.8,duration:.4,sourceStart:0,transition:{fromClipId:'left',toClipId:'right',direction:'clockwise'}},{id:'sound',kind:'audio',start:0,duration:2,sourceStart:0,volume:1}]};
  expect(compositionReviewScope(timeline,1.1,1.2).clips.map(clip=>clip.id)).toEqual(['left','right','transition']);
  const goal={...plan,targetClipId:'right'} as import('../lib/ai/edit-plan').EffectPlan,review={timeline,plans:[goal],start:1.1,end:1.2};
  expect(currentReviewPlanIds(review,{...timeline,clips:timeline.clips.map(clip=>({...clip,volume:.2}))},[goal])).toEqual(['round']);
  expect(currentReviewPlanIds(review,{...timeline,clips:timeline.clips.map(clip=>clip.id==='left'?{...clip,sourceStart:.1}:clip)},[goal])).toEqual([]);
  const legacy:import('../lib/editor/types').Timeline={fps:30,aspectRatio:'landscape',tracks:{visual:1,overlay:2,audio:0},clips:[...timeline.clips.filter(clip=>clip.kind==='video'),{id:'title',kind:'caption',start:0,duration:2,sourceStart:0,text:'Foreground'}]};
  expect(compositionReviewScope(legacy,1.1,1.2)).not.toEqual(compositionReviewScope({...legacy,tracks:{visual:2,overlay:2,audio:0}},1.1,1.2));
});
