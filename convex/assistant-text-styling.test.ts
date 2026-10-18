import { getFunctionName } from 'convex/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Timeline } from '../lib/editor/types';
const fixture = vi.hoisted(() => ({ generate: undefined as undefined | ((tools: Record<string, { inputSchema: { parse: (input: unknown) => unknown }; execute: (ctx: unknown, input: unknown) => Promise<unknown> }>) => Promise<unknown>) }));
vi.mock('@convex-dev/agent', async original => ({ ...await original<Record<string, unknown>>(), createTool: (options: unknown) => options, saveMessage: async () => null,
  Agent: class {
    constructor(_component: unknown, private options: { tools: Parameters<NonNullable<typeof fixture.generate>>[0] }) {}
    async streamText() { await fixture.generate!(this.options.tools); return { finishReason: Promise.resolve('stop'), steps: Promise.resolve([]) }; }
  },
}));
import { respond } from './assistantActions';
beforeEach(() => { vi.stubEnv('OPENAI_API_KEY', 'fixture-only'); vi.stubEnv('EDITOR_ENFORCE_TOKEN_BUDGET', 'false'); vi.stubEnv('MODEL_SWITCHER_ENABLED', 'false'); vi.stubEnv('AI_COST_DASHBOARD_ENABLED', 'false'); });
afterEach(() => vi.unstubAllEnvs());

test('the actual existing batch tool restyles four graphic titles and requested casing in one saved operation', async () => {
  let timeline: Timeline = { fps: 30, aspectRatio: 'landscape', clips: Array.from({ length: 4 }, (_, index) => ({ id: `title-${index}`, kind: 'graphic', text: `${index + 1}) UPLOAD YOUR FOOTAGE`, start: index * 3, duration: 3, sourceStart: 0, background: '#000000', animation: 'rise' })) };
  const original = structuredClone(timeline); let revision = 27, writes = 0, finishError: string | undefined;
  fixture.generate = async tools => {
    const tool = tools.styleCaptions;
    const input = tool.inputSchema.parse({ clipIds: timeline.clips.map(clip => clip.id), fontFamily: 'poppins', background: 'transparent', textStyle: { strokeWidth: 3, strokeColor: '#000000', glowBlur: 0, shadowBlur: 0 }, textCase: 'sentence' });
    expect(await tool.execute({}, input)).toMatchObject({ saved: true, staged: false, revision: 28 });
  };
  const ctx = {
    runQuery: async (ref: Parameters<typeof getFunctionName>[0]) => {
      switch (getFunctionName(ref)) {
        case 'assistant:getRun': return { project: { timeline, revision, aspectRatio: timeline.aspectRatio }, assets: [] };
        case 'assistant:currentPrompt': return 'Restyle these exact four labels and use sentence case.';
        case 'assistant:isRunActive': return true;
        default: throw new Error('Unexpected query');
      }
    },
    runMutation: async (ref: Parameters<typeof getFunctionName>[0], args: { timeline: Timeline; error?: string }) => {
      switch (getFunctionName(ref)) {
        case 'assistant:beginEditing': return null;
        case 'assistant:apply': writes++; timeline = args.timeline; return ++revision;
        case 'assistant:finish': finishError = args.error; return null;
        default: throw new Error('No plan, media analysis or rendered review is needed for plain styling');
      }
    },
  };
  await (respond as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler(ctx, { projectId: 'project', ownerId: 'owner', runId: 'run', threadId: 'thread', promptMessageId: 'prompt', pinnedModel: { provider: 'openai', modelId: 'gpt-6.1-sol', modelChoice: 'gpt-6.1-sol' } });
  expect(finishError).toBeUndefined(); expect(writes).toBe(1); expect(revision).toBe(28);
  expect(timeline.clips.every(clip => clip.background === 'transparent' && clip.fontFamily === 'poppins' && clip.text?.endsWith('Upload your footage'))).toBe(true);
  expect(timeline.clips.map(({ start, duration, animation }) => ({ start, duration, animation }))).toEqual(original.clips.map(({ start, duration, animation }) => ({ start, duration, animation })));
});

test('five identical visual transforms save as one atomic batch and preserve linked audio and timing', async () => {
  let timeline: Timeline = { fps: 30, aspectRatio: 'landscape', clips: Array.from({ length: 5 }, (_, index) => [
    { id: `video-${index}`, kind: 'video' as const, linkedClipId: `audio-${index}`, start: index * 3, duration: 3, sourceStart: index * 8, playbackRate: 2 },
    { id: `audio-${index}`, kind: 'audio' as const, linkedClipId: `video-${index}`, start: index * 3, duration: 3, sourceStart: index * 8, playbackRate: 2 },
  ]).flat() };
  const original = structuredClone(timeline); let revision = 35, writes = 0, finishError: string | undefined;
  fixture.generate = async tools => {
    for(const name of ['configureVisualFade','setVisualEffects','setPlaybackRate','applyMotionPreset','animateClip'])expect(tools[name],`${name} remains available`).toBeDefined();
    const tool = tools.transformClip;
    expect(() => tool.inputSchema.parse({ clipId: 'video-0', clipIds: ['video-1'], scale: .84 })).toThrow();
    expect(() => tool.inputSchema.parse({ clipIds: ['video-0', 'video-0'], scale: .84 })).toThrow();
    const batch = tool.inputSchema.parse({ clipIds: original.clips.filter(clip => clip.kind === 'video').map(clip => clip.id), scale: .84, x: .5, y: .57 });
    expect(await tool.execute({}, batch)).toMatchObject({ saved: true, staged: false, revision: 36 });
    const afterBatch = structuredClone(timeline);
    await expect(tool.execute({}, tool.inputSchema.parse({ clipIds: ['video-0', 'audio-0'], scale: .5 }))).rejects.toThrow('video or image');
    expect(timeline).toEqual(afterBatch); expect(writes).toBe(1);
    expect(await tool.execute({}, tool.inputSchema.parse({ clipId: 'video-0', opacity: .8 }))).toMatchObject({ saved: true, revision: 37 });
  };
  const ctx = {
    runQuery: async (ref: Parameters<typeof getFunctionName>[0]) => {
      switch (getFunctionName(ref)) {
        case 'assistant:getRun': return { project: { timeline, revision, aspectRatio: timeline.aspectRatio }, assets: [] };
        case 'assistant:currentPrompt': return 'Use the same smaller framing for all five video clips.';
        case 'assistant:isRunActive': return true;
        default: throw new Error('Unexpected query');
      }
    },
    runMutation: async (ref: Parameters<typeof getFunctionName>[0], args: { timeline: Timeline; error?: string }) => {
      switch (getFunctionName(ref)) {
        case 'assistant:beginEditing': return null;
        case 'assistant:apply': writes++; timeline = args.timeline; return ++revision;
        case 'assistant:finish': finishError = args.error; return null;
        default: throw new Error('Unexpected mutation');
      }
    },
  };
  await (respond as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler(ctx, { projectId: 'project', ownerId: 'owner', runId: 'run', threadId: 'thread', promptMessageId: 'prompt', pinnedModel: { provider: 'openai', modelId: 'gpt-6.1-sol', modelChoice: 'gpt-6.1-sol' } });
  expect(finishError).toBeUndefined(); expect(writes).toBe(2);
  expect(timeline.clips.filter(clip => clip.kind === 'video').every(clip => clip.transform?.scale === .84 && clip.transform.y === .57)).toBe(true);
  expect(timeline.clips.filter(clip => clip.kind === 'audio')).toEqual(original.clips.filter(clip => clip.kind === 'audio'));
  expect(timeline.clips.map(({ start, duration, sourceStart, playbackRate }) => ({ start, duration, sourceStart, playbackRate }))).toEqual(original.clips.map(({ start, duration, sourceStart, playbackRate }) => ({ start, duration, sourceStart, playbackRate })));
});

test('same corner-rounding settings apply to five video clips in one atomic save', async () => {
  let timeline:Timeline={fps:30,aspectRatio:'landscape',clips:Array.from({length:5},(_,index)=>({id:`video-${index}`,kind:'video',start:index*3,duration:3,sourceStart:index*8,playbackRate:2,linkedClipId:`audio-${index}`}))};
  const original=structuredClone(timeline);let revision=40,writes=0,error:string|undefined;
  fixture.generate=async tools=>{
    const tool=tools.setVisualEffects,input=tool.inputSchema.parse({clipIds:timeline.clips.map(clip=>clip.id),frameCorners:{enabled:true,amount:.06}});
    expect(await tool.execute({},input)).toMatchObject({saved:true,revision:41});
    const saved=structuredClone(timeline);
    await expect(tool.execute({},tool.inputSchema.parse({clipIds:['video-0','missing'],frameCorners:{enabled:true,amount:.2}}))).rejects.toThrow('Clip not found');
    expect(timeline).toEqual(saved);expect(writes).toBe(1);
    expect(()=>tool.inputSchema.parse({clipId:'video-0',clipIds:['video-1'],frameCorners:{enabled:true,amount:.2}})).toThrow();
    expect(await tool.execute({},tool.inputSchema.parse({clipId:'video-0',softBlur:{enabled:true,amount:2}}))).toMatchObject({saved:true,revision:42});
  };
  const ctx={runQuery:async(ref:Parameters<typeof getFunctionName>[0])=>{switch(getFunctionName(ref)){case'assistant:getRun':return{project:{timeline,revision,aspectRatio:timeline.aspectRatio},assets:[]};case'assistant:currentPrompt':return'Round the corners of all five video clips.';case'assistant:isRunActive':return true;default:throw new Error('Unexpected query');}},runMutation:async(ref:Parameters<typeof getFunctionName>[0],args:{timeline:Timeline;error?:string})=>{switch(getFunctionName(ref)){case'assistant:beginEditing':return null;case'assistant:apply':writes++;timeline=args.timeline;return++revision;case'assistant:finish':error=args.error;return null;default:throw new Error('Unexpected mutation');}}};
  await(respond as unknown as{_handler:(ctx:unknown,args:unknown)=>Promise<unknown>})._handler(ctx,{projectId:'project',ownerId:'owner',runId:'run',threadId:'thread',promptMessageId:'prompt',pinnedModel:{provider:'openai',modelId:'gpt-6.1-sol',modelChoice:'gpt-6.1-sol'}});
  expect(error).toBeUndefined();expect(writes).toBe(2);expect(timeline.clips.every(clip=>clip.frameCorners?.enabled&&clip.frameCorners.amount===.06)).toBe(true);
  expect(timeline.clips.map(({start,duration,sourceStart,playbackRate,linkedClipId})=>({start,duration,sourceStart,playbackRate,linkedClipId}))).toEqual(original.clips.map(({start,duration,sourceStart,playbackRate,linkedClipId})=>({start,duration,sourceStart,playbackRate,linkedClipId})));
});

test('captured multi-clip layout request batches five framing/effects and four titles within fifteen calls including review and one fix',async()=>{
 let timeline:Timeline={fps:30,aspectRatio:'landscape',clips:[...Array.from({length:5},(_,i)=>({id:`v${i}`,assetId:'source',kind:'video'as const,start:i*3,duration:3,sourceStart:i*3,track:1})),...Array.from({length:4},(_,i)=>({id:`t${i}`,kind:'graphic'as const,start:i*3,duration:3,sourceStart:0,track:2,text:`${i+1}) Step`,y:.3}))]};
 let revision=1,writes=0,error:string|undefined,reviewRevision=0;
 const executed:string[]=[],assets=[{_id:'source',kind:'video',fileName:'fixture.mp4',duration:30,width:1920,height:1080}];
 fixture.generate=async tools=>{
  const execute=async(name:string,input:unknown)=>{executed.push(name);return tools[name].execute({},tools[name].inputSchema.parse(input));};
  await execute('inspectTimeline',{});
  await execute('planEffects',{plans:[{id:'corners',kind:'visual',effect:'frameCorners',targetClipId:'v0',purpose:'Round corners as requested',strength:'Amount0.06',expectation:'Rounded outer video corners remain visible',start:0,duration:2,anchor:{kind:'requested-time',time:0,description:'Requested first screen'}}]});
  await execute('transformClip',{clipIds:['v0','v1','v2','v3','v4'],scale:.84,x:.5,y:.57});
  await execute('setVisualEffects',{clipIds:['v0','v1','v2','v3','v4'],frameCorners:{enabled:true,amount:.06}});
  await execute('styleCaptions',{clipIds:['t0','t1','t2','t3'],x:.5,y:.075});
  await execute('previewRender',{planIds:['corners']});
  await execute('styleCaptions',{clipIds:['t0','t1','t2','t3'],y:.1});
  await execute('previewRender',{planIds:['corners']});
  await execute('inspectTimeline',{});
 };
 const ctx={runQuery:async(ref:Parameters<typeof getFunctionName>[0])=>{switch(getFunctionName(ref)){case'assistant:getRun':return{project:{timeline,revision,aspectRatio:timeline.aspectRatio},assets};case'assistant:getRunTimeline':return{timeline,revision};case'assistant:currentPrompt':return'Reduce each screen, round every corner and place all labels above it.';case'assistant:isRunActive':return true;case'compositionReview:get':return{status:'completed',result:{revision:reviewRevision,checks:[],observations:[],uncertainty:'Mock render protocol only; not a visual quality claim'}};default:throw new Error('Unexpected query');}},runMutation:async(ref:Parameters<typeof getFunctionName>[0],args:{timeline:Timeline;error?:string;expectedRevision?:number})=>{switch(getFunctionName(ref)){case'assistant:beginEditing':case'compositionReview:savePlan':case'compositionReview:cancel':return null;case'compositionReview:request':reviewRevision=args.expectedRevision!;return'review';case'assistant:apply':writes++;timeline=args.timeline;return++revision;case'assistant:finish':error=args.error;return null;default:throw new Error('Unexpected mutation');}}};
 await(respond as unknown as{_handler:(ctx:unknown,args:unknown)=>Promise<unknown>})._handler(ctx,{projectId:'project',ownerId:'owner',runId:'run',threadId:'thread',promptMessageId:'prompt',pinnedModel:{provider:'openai',modelId:'gpt-6.1-sol',modelChoice:'gpt-6.1-sol'}});
 expect(error).toBeUndefined();expect(executed).toHaveLength(9);expect(executed.length).toBeLessThan(15);expect(writes).toBe(4);
 expect(timeline.clips.filter(clip=>clip.kind==='video').every(clip=>clip.transform?.scale===.84&&clip.frameCorners?.amount===.06)).toBe(true);
 expect(timeline.clips.filter(clip=>clip.kind==='graphic').every(clip=>clip.y===.1&&clip.x===.5)).toBe(true);
});
