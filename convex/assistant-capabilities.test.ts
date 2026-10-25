import workflowTest from '@convex-dev/workflow/test';
import {mediaWorkflow} from './lib/workflows';
import {AssistantBudgetError} from '../lib/ai/run-budget';
import { writeProject } from './lib/project_data';
/// <reference types="vite/client" />
import { beforeEach,afterEach,expect,test,vi } from 'vitest';
import { convexTest } from 'convex-test';
import agentTest from '@convex-dev/agent/test';
import {createThread,saveMessages} from '@convex-dev/agent';
import schema from './schema';
import {api,internal,components} from './_generated/api';
import type {TimelinePublicationReceipt} from '../lib/ai/publication-receipt';
import { getFunctionName } from 'convex/server';
import type { Timeline } from '../lib/editor/types';
import { TRANSITION_PRESETS } from '../lib/editor/clip-transitions';
import { addEffectClip, addTransitionClip, patchClip } from '../lib/editor/operations';
import { EFFECT_CATALOG,OFFERED_TIMED_EFFECT_PRESETS } from '../lib/editor/clip-effects';
import { editorCapabilities } from '../lib/ai/editor-capabilities';
import { resolvedTextAppearance } from '../lib/editor/text-style';
import type { EffectPlan } from '../lib/ai/edit-plan';
import { AUDIO_ROLES,audioSettings,audioVolumeEnvelope,audioFadeGain,audioFadeAttributes } from '../lib/editor/audio-settings';
import { TEXT_ANIMATION_PRESETS } from '../lib/editor/text-effects';
import { TEXT_FONTS } from '../lib/editor/text-fonts';
import { TEXT_LOOKS } from '../lib/editor/text-looks';
import { createEditorStore } from '../lib/editor/store';
import { textLayerFrame } from '../lib/editor/text-layers';
import {DEFAULT_NEON_EDGES} from '../lib/editor/neon-edges';
import { DEFAULT_FRAME_DISTORTION, DEFAULT_LENS_DISTORTION, DEFAULT_VHS, DEFAULT_LIGHT_LEAK, DEFAULT_DIRECTIONAL_BLUR, DEFAULT_TURBULENT_DISPLACE, DEFAULT_LIGHT_SWEEP, VISUAL_EFFECT_LIMITS } from '../lib/editor/visual-effects';
import { parseAutomation,sampleAutomationLane } from '@hyperframes/core/audio-automation';
import { fadeGain } from '@hyperframes/core/audio-fade';
import type { ZodType } from 'zod';
import { execFileSync } from 'node:child_process';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText,stepCountIs,tool } from 'ai';
import { CLAUDE_MODEL,claudeProviderOptions } from '../lib/ai/claude-model';

type Tool={description:string;inputSchema:ZodType;execute:(ctx:unknown,input:unknown)=>Promise<unknown>};
const sdk=vi.hoisted(()=>({options:null as null|{instructions:string;tools:Record<string,Tool>},plan:async()=>{},steps:[] as {content:unknown[]}[],finishReason:'stop',streams:[] as Record<string,unknown>[],messages:[] as unknown[]}));
vi.mock('@convex-dev/agent',async importOriginal=>({
  ...await importOriginal<Record<string,unknown>>(),
  Agent:class{constructor(_component:unknown,readonly options:NonNullable<typeof sdk.options>){sdk.options=options}async streamText(_ctx:unknown,_thread:unknown,args:Record<string,unknown>,options?:{contextHandler?:(ctx:unknown,input:{allMessages:import('ai').ModelMessage[]})=>Promise<import('ai').ModelMessage[]>}){sdk.streams.push({...args,context:options?.contextHandler?await options.contextHandler({}, {allMessages:[]}):[]});await sdk.plan();return{finishReason:Promise.resolve(sdk.finishReason),steps:Promise.resolve([...sdk.steps])}}},
  createTool:(options:unknown)=>options,saveMessage:async(_ctx:unknown,_component:unknown,message:unknown)=>{sdk.messages.push(message)},stepCountIs:()=>()=>false,
}));
import { respond } from './assistantActions';

const initial:Timeline={fps:30,aspectRatio:'landscape',tracks:{visual:2,overlay:0,audio:1,effects:0},clips:[
  {id:'from',kind:'video',assetId:'video',track:1,start:0,duration:3,sourceStart:2,volume:0,audioSeparated:true,linkedClipId:'audio'},
  {id:'audio',kind:'audio',assetId:'sound',track:1,start:0,duration:3,sourceStart:2,volume:.6,linkedClipId:'from'},
  {id:'to',kind:'image',assetId:'image',track:1,start:3,duration:3,sourceStart:0},
  {id:'title',kind:'caption',track:2,start:0,duration:2,sourceStart:0,text:'Keep these words',animation:'fade',color:'#ffffff',background:'transparent',textTemplate:{preset:'karaoke',duration:2,offset:0,highlightColor:'#FFFF00'}},
]};
beforeEach(()=>{sdk.options=null;sdk.plan=async()=>{};sdk.steps=[];sdk.finishReason='stop';sdk.streams=[];sdk.messages=[];vi.stubEnv('BILLING_ENABLED','false');vi.stubEnv('OPENAI_API_KEY','fixture-only');vi.stubEnv('EDITOR_DEFAULT_MODEL','gpt-6.1-sol');vi.stubEnv('AI_GATEWAY_ENABLED','false')});
afterEach(()=>vi.unstubAllEnvs());
async function memoryBackend(seed:Timeline,priorHistory:Timeline[]=[]){
  const t=convexTest(schema,import.meta.glob('./**/*.ts')),owner=t.withIdentity({subject:'owner'});
  agentTest.register(t);
  const threadId=await t.run(ctx=>createThread(ctx,components.agent,{userId:'owner'}));
  const promptMessageId=await t.run(async ctx=>(await saveMessages(ctx,components.agent,{threadId,userId:'owner',messages:[{role:'user',content:'Synthetic editing request'}]})).messages[0]._id);
  const projectId=await owner.mutation(api.projects.create,{title:'Synthetic tool harness',aspectRatio:seed.aspectRatio});
  const mapping=await t.run(async ctx=>{
    const fields={ownerId:'owner',projectId,size:1,duration:30,createdAt:Date.now()};
    const sound=await ctx.db.insert('assets',{...fields,kind:'audio',fileName:'Synthetic voice.wav',contentType:'audio/wav'});
    const video=await ctx.db.insert('assets',{...fields,kind:'video',fileName:'CAD sample.mp4',contentType:'video/mp4',width:1920,height:1080,audioAssetId:sound,audioExtracted:true});
    const image=await ctx.db.insert('assets',{...fields,kind:'image',fileName:'Synthetic still.png',contentType:'image/png'});
    return{sound,video,image};
  });
  const map=(input:Timeline)=>({...input,clips:input.clips.map(clip=>({...clip,...(clip.assetId?{assetId:mapping[clip.assetId as keyof typeof mapping]}:{})}))});
  const timeline=map(seed),history=priorHistory.map(map),revision=history.length;
  await t.run(ctx=>writeProject(ctx,projectId,{timeline,history,revision,threadId,aiRunning:true,aiRunId:'run',aiUndoRecorded:false}));
  return{t,owner,projectId,threadId,promptMessageId,seed:timeline,priorHistory:history,revision,runArgs:{projectId,ownerId:'owner',runId:'run'}};
}
async function run(plan?:(tools:Record<string,Tool>)=>Promise<void>,seed:Timeline=initial,realBackend=false,priorHistory:Timeline[]=[],options:{backend?:Awaited<ReturnType<typeof memoryBackend>>;continuation?:{segment:number;savedEdits:number};rejectValidationAt?:number[]}={}){
  const backend=options.backend??(realBackend?await memoryBackend(seed,priorHistory):undefined);
  const fresh=options.backend?await options.backend.owner.query(api.projects.get,{projectId:options.backend.projectId}):undefined;
  let timeline=structuredClone(fresh?.timeline??backend?.seed??seed),revision=fresh?.revision??backend?.revision??0,error:string|undefined;
  const calls:string[]=[];let validations=0;let plannedEffects:EffectPlan[]=[];
  const project=()=>({_id:'project',timeline,revision,aspectRatio:'landscape'});
  const ctx={
    runQuery:async(reference:Parameters<typeof getFunctionName>[0],args:{timeline?:Timeline;expectedRevision?:number})=>{
      const name=getFunctionName(reference);calls.push(name);
      if(name==='compositionReview:readPlan')return [];
      if(name==='compositionReview:completionState')return {plans:plannedEffects,validReviews:[]};
      if(backend){
      if(name==='assistant:currentPrompt')return 'Synthetic editing request';
        if(name==='assistant:getRun')return backend.t.query(internal.assistant.getRun,backend.runArgs);
        if(name==='assistant:isRunActive')return backend.t.query(internal.assistant.isRunActive,backend.runArgs);
        if(name==='assistant:validateDraft')return backend.t.query(internal.assistant.validateDraft,{...backend.runArgs,timeline:args.timeline!,expectedRevision:args.expectedRevision!});
      }
      if(name==='assistant:currentPrompt')return 'Synthetic editing request';
      if(name==='assistant:getRun')return{project:project(),assets:[{_id:'video',kind:'video',fileName:'Own video',duration:30},{_id:'sound',kind:'audio',fileName:'Own audio',duration:30},{_id:'image',kind:'image',fileName:'Own image'}]};
      if(name==='assistant:isRunActive')return true;
      if(name==='assistant:validateDraft')return null;
      throw new Error('Unexpected query '+name);
    },
    runMutation:async(reference:Parameters<typeof getFunctionName>[0],args:{timeline?:Timeline;expectedRevision?:number;error?:string;publication?:Pick<TimelinePublicationReceipt,'threadId'|'promptMessageId'>|Extract<TimelinePublicationReceipt,{status:'failed'|'aborted'}>})=>{
      const name=getFunctionName(reference);calls.push(name);
      if(name==='compositionReview:savePlan'){plannedEffects=(args as unknown as {plans:EffectPlan[]}).plans;return null;}
      if(name==='assistant:previewDraft'&&options.rejectValidationAt?.includes(++validations))throw new Error('Temporary draft validation unavailable.');
      if(name==='assistant:previewDraft')return backend?backend.t.mutation(internal.assistant.previewDraft,{...backend.runArgs,timeline:args.timeline!,expectedRevision:args.expectedRevision!}):null;
      if(name==='assistant:beginEditing')return backend?backend.t.mutation(internal.assistant.beginEditing,backend.runArgs):null;
      if(name==='assistant:undoLatestEdit'){
        if(!backend)throw new Error('Undo requires the in-memory saved backend.');
        const result=await backend.t.mutation(internal.assistant.undoLatestEdit,{...backend.runArgs,expectedRevision:args.expectedRevision!});timeline=structuredClone(result.timeline);revision=result.revision;return result;
      }
      if(name==='assistant:apply'){expect(args.expectedRevision).toBe(revision);timeline=structuredClone(args.timeline!);revision=backend?await backend.t.mutation(internal.assistant.apply,{...backend.runArgs,timeline,expectedRevision:revision,...(args.publication?{publication:args.publication}:{})}):revision+1;return revision}
      if(name==='assistant:finish'){error=args.error;return backend?backend.t.mutation(internal.assistant.finish,{...backend.runArgs,...(error?{error}:{}),...(args.publication?{publication:args.publication as Extract<TimelinePublicationReceipt,{status:'failed'|'aborted'}>}: {})}):null}
      throw new Error('Unexpected mutation '+name);
    },
  };
  sdk.plan=async()=>{
    if(plan)await plan(sdk.options!.tools);
    // These operation-parity tests mock the renderer, just as they mock the
    // model. Explicit failure/recovery fixtures supply their own receipts.
    if(!sdk.steps.length&&plannedEffects.length)sdk.steps=Array.from({length:Math.ceil(plannedEffects.length/2)},(_,index)=>{
      const ids=plannedEffects.slice(index*2,index*2+2).map(plan=>plan.id);
      return {content:[{type:'tool-call',toolName:'previewRender',toolCallId:`fixture-review-${index}`,input:{planIds:ids}},{type:'tool-result',toolName:'previewRender',toolCallId:`fixture-review-${index}`,output:{reviewed:true,stale:false,revision,currentRevision:revision,sampleTimes:[0],observations:ids.map(planId=>({planId,verdict:'pass',evidence:'Synthetic renderer fixture for operation-parity tests.'})),checks:ids.map(planId=>({planId,timingPass:true,pixelPass:true,textSafe:true,returnPass:true}))}}]};
    });
  };
  const handler=(respond as unknown as {_handler:(ctx:unknown,args:unknown)=>Promise<unknown>})._handler;
  const outcome=await handler(ctx,{durable:true,...options.continuation?{continuation:options.continuation}:{},projectId:backend?.projectId??'project',ownerId:'owner',runId:'run',threadId:backend?.threadId??'thread',promptMessageId:backend?.promptMessageId??'greeting-message',playhead:1});
  const history=backend?(await backend.owner.query(api.projects.get,{projectId:backend.projectId})).history??[]:[];
  return{timeline,revision,calls,history,error,backend,outcome};
}
const execute=async(tools:Record<string,Tool>,name:string,input:unknown)=>{
  if(name==='addTimedEffect'){
    const effect=input as {preset:typeof OFFERED_TIMED_EFFECT_PRESETS[number];start?:number;duration?:number};
    const start=effect.start??1,duration=effect.duration??EFFECT_CATALOG[effect.preset].duration;
    await tools.planEffects.execute({},{plans:[{id:'test-effect',kind:'timed',effect:effect.preset,start,duration,purpose:'Requested synthetic effect',strength:'Requested controls',expectation:'The requested effect is visible',anchor:{kind:'requested-time',time:start,description:'Explicit fixture timing'}}]});
  }
  return tools[name].execute({},tools[name].inputSchema.parse(input));
};
const trimmed:Timeline={...initial,clips:initial.clips.map(c=>c.id==='from'||c.id==='audio'?{...c,duration:1.5}:c)};

test('actual undo→unlink→delete tools restore saved source ranges and preserve original audio in a new undo group',async()=>{
  const result=await run(async tools=>{
    const undone=await execute(tools,'undoLatestEdit',{});
    expect(undone).toMatchObject({undone:true,saved:true,revision:2});
    const restored=await execute(tools,'inspectTimeline',{}) as{timeline:Timeline};
    expect(restored.timeline.clips.find(c=>c.id==='audio')).toMatchObject({duration:3,sourceStart:2,volume:.6,linkedClipId:'from'});
    expect(await execute(tools,'unlink',{clipId:'from'})).toMatchObject({unlinked:true,clipIds:['from','audio'],saved:true});
    const removed=await execute(tools,'delete',{clipId:'from'});
    expect(removed).toMatchObject({staged:true,saved:false,removedClipIds:['from']});
  },trimmed,true,[initial]);
  expect(result.timeline.clips.some(c=>c.id==='from')).toBe(false);
  expect(result.timeline.clips.find(c=>c.id==='audio')).toEqual({...result.backend!.priorHistory[0].clips[1],linkedClipId:undefined});
  expect(result.timeline.clips.filter(c=>c.id!=='audio')).toEqual(result.backend!.priorHistory[0].clips.slice(2));
  const messages=await result.backend!.owner.query(api.assistant.messages,{projectId:result.backend!.projectId,threadId:result.backend!.threadId,paginationOpts:{cursor:null,numItems:20}});
  expect(messages.page.flatMap(m=>m.parts).map(p=>p.type==='text'?p.providerMetadata?.revline?.publicationReceipt:undefined).filter(Boolean)).toEqual([{version:1,kind:'timeline-publication',status:'saved',runId:'run',threadId:result.backend!.threadId,promptMessageId:result.backend!.promptMessageId,stagedRevision:3,revision:4}]);
  await assertUndo(result,result.backend!.priorHistory[0]);
});

test('undo returns a truthful empty result and refuses both saved and private staged current-turn mutations',async()=>{
  const empty=await run(async tools=>expect(await execute(tools,'undoLatestEdit',{})).toMatchObject({undone:false,saved:false,message:'No saved edits to undo.'}),initial,true);
  expect(empty.revision).toBe(0);expect(empty.history).toEqual([]);
  const saved=await run(async tools=>{
    await execute(tools,'styleTextClip',{clipId:'title',fontSize:80});
    await expect(execute(tools,'undoLatestEdit',{})).rejects.toThrow('before making changes');
  },initial,true);
  expect(saved.calls).not.toContain('assistant:undoLatestEdit');await assertUndo(saved);
  const staged=await run(async tools=>{
    await execute(tools,'delete',{clipId:'to'});
    await expect(execute(tools,'undoLatestEdit',{})).rejects.toThrow('before making changes');
  },initial,true);
  expect(staged.calls).not.toContain('assistant:undoLatestEdit');
  expect(staged.error).toContain('latest valid partial edit was saved');
  expect((await staged.backend!.owner.query(api.projects.get,{projectId:staged.backend!.projectId})).timeline?.clips.some(clip=>clip.id==='to')).toBe(false);
  expect(staged.history).toEqual([staged.backend!.seed]);
  const messages=await staged.backend!.owner.query(api.assistant.messages,{projectId:staged.backend!.projectId,threadId:staged.backend!.threadId,paginationOpts:{cursor:null,numItems:20}});
  expect(messages.page.flatMap(m=>m.parts).map(p=>p.type==='text'?p.providerMetadata?.revline?.publicationReceipt:undefined).filter(Boolean)).toEqual([{version:1,kind:'timeline-publication',status:'saved',runId:'run',threadId:staged.backend!.threadId,promptMessageId:staged.backend!.promptMessageId,stagedRevision:0,revision:1}]);
});

test('group copy/move/trim, layer reorder and common blend use actual editor operations while preserving source identity',async()=>{
  const seeded=addTransitionClip(initial,'seed-crossfade','crossfade','from','to');
  const result=await run(async tools=>{
    const current=await execute(tools,'inspectTimeline',{}) as{timeline:Timeline};
    const oldTransition=current.timeline.clips.find(c=>c.transition)!;
    const copied=await execute(tools,'duplicateClips',{clipIds:['from','to',oldTransition.id],at:6}) as{newClipIds:string[]};
    const duplicated=await execute(tools,'inspectTimeline',{}) as{timeline:Timeline};
    const copiedPair=duplicated.timeline.clips.find(c=>copied.newClipIds.includes(c.id)&&c.transition)!;
    // Probe rejected operations before starting the private source assembly.
    await expect(execute(tools,'duplicateClips',{clipIds:[oldTransition.id],at:20})).rejects.toThrow(/inside footage|onto a cut/i);
    await expect(execute(tools,'setBlendMode',{clipIds:[copiedPair.transition!.fromClipId],blendMode:'screen'})).rejects.toThrow('same blend');
    await execute(tools,'moveClips',{clipIds:copied.newClipIds,timeDelta:2,layerDelta:1});
    const moved=await execute(tools,'inspectTimeline',{}) as{timeline:Timeline};
    const pair=moved.timeline.clips.find(c=>copied.newClipIds.includes(c.id)&&c.transition)!;
    expect(pair.transition!.fromClipId).not.toBe('from');expect(pair.transition!.toClipId).not.toBe('to');
    await execute(tools,'setBlendMode',{clipIds:[pair.transition!.fromClipId,pair.transition!.toClipId],blendMode:'screen'});
    await execute(tools,'resizeClips',{clipIds:[pair.transition!.fromClipId],side:'left',delta:.2});
    await execute(tools,'reorderLayer',{group:'visual',from:2,to:3});
    await execute(tools,'followSubject',{clipId:'from',enabled:false});
  },seeded,true);
  const copies=result.timeline.clips.filter(c=>c.kind==='video'&&c.id!=='from');expect(copies).toHaveLength(1);
  const copy=copies[0],audio=result.timeline.clips.find(c=>c.id===copy.linkedClipId)!;
  expect(copy).toMatchObject({track:3,start:8.2,duration:2.8,sourceStart:2.2,blendMode:'screen',assetId:result.backend!.seed.clips[0].assetId});
  expect(audio).toMatchObject({start:8.2,duration:2.8,sourceStart:2.2,volume:.6,linkedClipId:copy.id});
  expect(result.timeline.clips.find(c=>c.id==='title')).toEqual({...result.backend!.seed.clips[3],track:3});
  expect(result.timeline.clips.find(c=>c.id==='to')).toEqual(result.backend!.seed.clips[2]);
  expect(result.timeline.clips.filter(c=>c.transition)).toHaveLength(2);
  await assertUndo(result);
});

const withVoiceOver:Timeline={...initial,clips:[...initial.clips,{id:'vo',kind:'audio',assetId:'sound',track:1,start:4,duration:3,sourceStart:10,volume:1}]};
test('single move and trim tools never leave a clip or its linked audio overlapping another clip on the same layer',async()=>{
  const result=await run(async tools=>{
    await expect(execute(tools,'trim',{clipId:'from',duration:4})).rejects.toThrow(/overlap clip to on the same layer\. At most 3s fits/);
    await expect(execute(tools,'trim',{edits:[{clipId:'vo',duration:2},{clipId:'from',duration:3.5}]})).rejects.toThrow(/overlap clip to/);
    await execute(tools,'move',{clipId:'from',start:3.5});
  },withVoiceOver,true);
  const by=(id:string)=>result.timeline.clips.find(c=>c.id===id)!;
  // The video takes the next free V layer; its linked audio gets a new A layer instead of covering the voice-over.
  expect(by('from')).toMatchObject({start:3.5,duration:3,sourceStart:2,track:2});
  expect(by('audio')).toMatchObject({start:3.5,duration:3,sourceStart:2,track:2,linkedClipId:'from'});
  expect(by('vo')).toEqual(result.backend!.seed.clips[4]);
  expect(by('to')).toEqual(result.backend!.seed.clips[2]);
  await assertUndo(result);
});

test('assistant drafts refuse new same-layer overlaps but keep saved legacy overlaps editable',async()=>{
  const legacy:Timeline={...initial,clips:[...initial.clips,{id:'legacy',kind:'caption',track:2,start:1,duration:2,sourceStart:0,text:'Older overlapping words'}]};
  const backend=await memoryBackend(legacy);
  const draft=(clips:Timeline['clips'])=>backend.t.mutation(internal.assistant.previewDraft,{...backend.runArgs,expectedRevision:backend.revision,timeline:{...backend.seed,clips}});
  await expect(draft(backend.seed.clips.map(c=>c.id==='legacy'?{...c,text:'Edited overlapping words'}:c))).resolves.toBeNull();
  // A split piece inside the saved overlap is not a new collision.
  await expect(draft(backend.seed.clips.flatMap(c=>c.id==='title'?[{...c,duration:1.5,textTemplate:undefined},{...c,id:'title-b',start:1.5,duration:.5,textTemplate:undefined}]:[c]))).resolves.toBeNull();
  await expect(draft(backend.seed.clips.map(c=>c.id==='to'?{...c,start:2.5}:c))).rejects.toThrow(/from and to would overlap on the same layer/);
});

test('a plain greeting completion creates no edits or analysis requests and preserves concise abilities policy',async()=>{
  const result=await run();
  expect(result.timeline).toEqual(initial);expect(result.revision).toBe(0);
  expect(result.calls).toEqual(['assistant:getRun','assistant:currentPrompt','assistant:finish']);
  expect(sdk.options!.instructions).toContain('Greetings, small talk, and questions about your abilities do not request footage analysis or editing');
  expect(sdk.options!.instructions).toContain('short Markdown bullet list with bold capability names');
  expect(sdk.options!.instructions).toContain(JSON.stringify(editorCapabilities()));
});


test('unfinished tool feedback automatically resumes the same request and publishes the corrected draft once',async()=>{
  let pass=0;
  const input={clipId:'title',fontSize:80};
  const result=await run(async tools=>{
    pass++;
    if(pass===1){
      await execute(tools,'trim',{clipId:'from',duration:1.5});
      await expect(execute(tools,'styleTextClip',input)).rejects.toThrow('Temporary draft validation');
      sdk.steps=[{content:[{type:'tool-call',toolName:'styleTextClip',toolCallId:'failed-style',input},{type:'tool-error',toolName:'styleTextClip',toolCallId:'failed-style',error:'Temporary draft validation unavailable.'}]}];
    }else{
      expect(sdk.streams.at(-1)?.instructions).toBeUndefined();
      expect(JSON.stringify(sdk.streams.at(-1)?.context)).toContain('Temporary draft validation unavailable.');
      await execute(tools,'inspectTimeline',{});
      const output=await execute(tools,'styleTextClip',input);
      sdk.steps=[{content:[{type:'tool-call',toolName:'styleTextClip',toolCallId:'repaired-style',input},{type:'tool-result',toolName:'styleTextClip',toolCallId:'repaired-style',output}]}];
    }
  },initial,true,[],{rejectValidationAt:[2]});
  expect(pass).toBe(2);expect(result.error).toBeUndefined();
  expect(sdk.streams.every(stream=>stream.promptMessageId===result.backend!.promptMessageId)).toBe(true);
  expect(result.timeline.clips.find(c=>c.id==='from')?.duration).toBe(1.5);
  expect(result.timeline.clips.find(c=>c.id==='title')?.fontSize).toBe(80);
  expect(result.history).toEqual([result.backend!.seed]);
  expect((await result.backend!.owner.query(api.projects.get,{projectId:result.backend!.projectId})).aiRecovery).toBeUndefined();
  await assertUndo(result);
});

test('a failed visual check is corrected before completion without redoing the saved edit',async()=>{
  let pass=0;
  const result=await run(async tools=>{
    pass++;
    if(pass===1)await execute(tools,'styleTextClip',{clipId:'title',fontSize:80});
    else {expect(sdk.streams.at(-1)?.instructions).toBeUndefined();expect(JSON.stringify(sdk.streams.at(-1)?.context)).toContain('The requested outline is missing');}
    sdk.steps=[{content:[{type:'tool-result',toolName:'previewRender',toolCallId:`review-${pass}`,output:{reviewed:true,stale:false,revision:1,currentRevision:1,sampleTimes:[0],checks:[{planId:'outline',timingPass:true}],observations:[{planId:'outline',verdict:pass===1?'fail':'pass',evidence:pass===1?'The requested outline is missing':'Requested outline is visible'}]}}]}];
  },initial,true);
  expect(pass).toBe(2);expect(result.error).toBeUndefined();
  expect(result.revision).toBe(1);expect(result.history).toEqual([result.backend!.seed]);
});

test('a step-limit stop continues the remaining deliverable in the same draft before publication',async()=>{
  let pass=0;
  const result=await run(async tools=>{
    pass++;
    if(pass===1){await execute(tools,'trim',{clipId:'from',duration:1.5});sdk.finishReason='tool-calls';sdk.steps=[{content:[]}];}
    else{await execute(tools,'styleTextClip',{clipId:'title',fontSize:80});sdk.finishReason='stop';sdk.steps=[{content:[]}];}
  },initial,true);
  expect(pass).toBe(2);expect(result.error).toBeUndefined();
  expect(result.timeline.clips.find(c=>c.id==='title')?.fontSize).toBe(80);
  expect(result.timeline.clips.find(c=>c.id==='from')?.duration).toBe(1.5);
  expect(result.history).toEqual([result.backend!.seed]);
});

test('automatic completion recovery is bounded when tools keep failing and preserves the valid partial edit',async()=>{
  let pass=0;
  const result=await run(async tools=>{
    pass++;
    if(pass===1)await execute(tools,'trim',{clipId:'from',duration:1.5});
    sdk.steps=[{content:[{type:'tool-call',toolName:'inspectFrames',toolCallId:`failed-${pass}`,input:{clipId:'from'}},{type:'tool-result',toolName:'inspectFrames',toolCallId:`failed-${pass}`,output:{success:false,error:'Video inspection provider unavailable.'}}]}];
  },initial,true);
  expect(pass).toBe(3);expect(result.error).toContain('failed three times');
  expect(result.timeline.clips.find(c=>c.id==='from')?.duration).toBe(1.5);
  expect(result.history).toEqual([result.backend!.seed]);
});

test('every implemented effect, text animation/look and transition has a concrete shared behavior description',()=>{
  const catalog=editorCapabilities();
  for(const entry of [...catalog.effects.flatMap(category=>category.items),...catalog.timedFX,...catalog.text.animations,...catalog.text.looks]){
    expect(entry.description.trim().length).toBeGreaterThan(20);expect(entry.description).not.toBe('Add at the playhead');
  }
  expect(catalog.text.animations).toHaveLength(TEXT_ANIMATION_PRESETS.length);expect(catalog.text.looks).toHaveLength(6);
  expect(catalog.text.animations.find(item=>item.preset==='karaoke')?.description).toContain('Supplied speech timings');
  expect(catalog.visual.canvasReference.landscape).toEqual({width:1920,height:1080});expect(catalog.visual.canvasReference.vertical).toEqual({width:1080,height:1920});
});

test('pixel transform/crop tools use known canvas/source axes, preserve omitted fields and reject unknown/impossible geometry',async()=>{
  await run(async tools=>await expect(execute(tools,'cropClip',{clipId:'from',units:'pixels',left:96})).rejects.toThrow('Known positive'));
  const result=await run(async tools=>{
    await execute(tools,'transformClip',{clipId:'from',units:'pixels',x:960,y:540,scale:1.25,rotation:12,opacity:.7});
    await execute(tools,'cropClip',{clipId:'from',units:'pixels',left:96,right:192,top:54});
    await execute(tools,'cropClip',{clipId:'from',bottom:.1});
    await expect(execute(tools,'transformClip',{clipId:'from',units:'pixels',x:11520})).rejects.toThrow('supported range');
    await expect(execute(tools,'cropClip',{clipId:'from',units:'pixels',left:1824})).rejects.toThrow('more than 5%');
  },initial,true);
  expect(result.timeline.clips[0]).toEqual({...result.backend!.seed.clips[0],transform:{x:.5,y:.5,scale:1.25,rotation:12,opacity:.7},crop:{left:.05,right:.1,top:.05,bottom:.1}});
  expect(result.timeline.clips.slice(1)).toEqual(result.backend!.seed.clips.slice(1));
  await assertUndo(result);
});

test('only offered timed FX and footage effects have tool schemas; retired effects and transitions are not offered',async()=>{
  await run(async tools=>{
    for(const preset of OFFERED_TIMED_EFFECT_PRESETS)expect(()=>tools.addTimedEffect.inputSchema.parse({preset})).not.toThrow();
    for(const preset of ['shake','flash','pop','cinematic-bars','zoom-blur','crossfade','fade'])expect(()=>tools.addTimedEffect.inputSchema.parse({preset})).toThrow();
    expect(tools).not.toHaveProperty('addClipTransition');expect(tools).not.toHaveProperty('configureClipTransition');
    for(const effect of ['dither','neonEdges','lightLeak','zoomBlur'])expect(()=>tools.resetVisualEffect.inputSchema.parse({clipId:'from',effect,action:'remove'})).toThrow();
    for(const group of ['dither','neonEdges','lightLeak','zoomBlur']){
      const parsed=tools.setVisualEffects.inputSchema.safeParse({clipId:'from',[group]:{enabled:true}});
      expect(parsed.success?(parsed.data as Record<string,unknown>)[group]:undefined).toBeUndefined();
    }
  });
  expect(sdk.messages).toHaveLength(0);
  const offered=editorCapabilities().effects.flatMap(group=>group.items).map(item=>item.name);
  for(const name of ['Zoom blur','Cinema bars','Dither','Neon edges','Light leak','Crossfade','Spin zoom'])expect(offered).not.toContain(name);
  expect(editorCapabilities()).not.toHaveProperty('transitions');expect(editorCapabilities()).not.toHaveProperty('neonEdges');
});

test('solid color creation/configuration changes only the new V rectangle and retains omitted controls',async()=>{
  const result=await run(async tools=>{
    await execute(tools,'addTimedEffect',{preset:'solid-color',start:1,duration:2,solidColor:{color:'#123456',width:.6,opacity:.8}});
    // Inspect exposes the actual saved ID; the tool never guesses or targets footage.
    const inspected=await execute(tools,'inspectTimeline',{}) as {timeline:Timeline};
    const rectangle=inspected.timeline.clips.find(clip=>clip.kind==='solid')!;
    await execute(tools,'setSolidColor',{clipId:rectangle.id,x:.2,height:.4});
    await expect(execute(tools,'setSolidColor',{clipId:'from',color:'#abcdef'})).rejects.toThrow('solid color clip');
  });
  expect(result.timeline.clips.slice(0,initial.clips.length)).toEqual(initial.clips);
  expect(result.timeline.clips.at(-1)?.solidColor).toEqual({color:'#123456',width:.6,height:.4,x:.2,y:.5,opacity:.8});
  expect(result.calls).not.toContain('assistant:requestAnalysis');
});

test('the assistant explicitly converts a saved FX solid and places its V layer behind footage',async()=>{
  const solid={id:'legacy-color',kind:'effect' as const,effectPreset:'solid-color' as const,track:1,start:0,duration:6,sourceStart:0,solidColor:{color:'#112233',width:1,height:1,x:.5,y:.5,opacity:1}};
  const seed={...initial,tracks:{...initial.tracks!,effects:1},clips:[...initial.clips,solid]};
  const result=await run(async tools=>{
    await execute(tools,'convertSolidColorToVisual',{clipId:solid.id});
    const inspected=await execute(tools,'inspectTimeline',{}) as {timeline:Timeline};
    const color=inspected.timeline.clips.find(clip=>clip.id===solid.id)!;
    expect(color.kind).toBe('solid');
    await execute(tools,'reorderLayer',{group:'visual',from:color.track,to:1});
  },seed,true);
  expect(result.error).toBeUndefined();
  expect(result.timeline.clips.at(-1)).toMatchObject({id:solid.id,kind:'solid',track:1,solidColor:solid.solidColor,start:0,duration:6,sourceStart:0});
  expect(result.timeline.clips.at(-1)?.effectPreset).toBeUndefined();
  expect(result.timeline.clips.find(clip=>clip.id==='from')?.track).toBe(2);
  expect(result.calls).not.toContain('assistant:requestAnalysis');
});

test('free marker tools accept requested seconds/labels, preserve clips and share one saved undo group without analysis',async()=>{
  const result=await run(async tools=>{
    expect(()=>tools.addMarker.inputSchema.parse({time:-1})).toThrow();
    expect(()=>tools.addMarker.inputSchema.parse({time:1,label:'x'.repeat(121)})).toThrow();
    await execute(tools,'addMarker',{time:1.19,label:'Start title'});
    await execute(tools,'addMarker',{time:2});
    await execute(tools,'addMarker',{time:2,label:'Duplicate'});
    const inspected=await execute(tools,'inspectTimeline',{}) as{timeline:Timeline};
    expect(inspected.timeline.markers).toHaveLength(2);
    const cue=inspected.timeline.markers!.find(marker=>marker.label==='Start title')!;
    await execute(tools,'moveMarker',{markerId:cue.id,time:3.19});
    await expect(execute(tools,'moveMarker',{markerId:'Start title',time:4})).rejects.toThrow('marker ID');
  },initial,true);
  expect(result.timeline.markers).toEqual([{id:expect.any(String),time:3.2,label:'Start title'},{id:expect.any(String),time:2}]);
  expect(result.timeline.clips).toEqual(result.backend!.seed.clips);
  await assertUndo(result);
});

test('Zoom agent controls share the manual recipe, preserve omitted controls and linked media, and undo together', async () => {
  const result = await run(async tools => {
    expect(() => tools.addTimedEffect.inputSchema.parse({ preset: 'punch', zoom: { amount: 2 } })).toThrow('Zoom');
    await execute(tools, 'addTimedEffect', { preset: 'quick-zoom-in', start: 1, duration: 2, zoom: { amount: 2, centerX: .75 } });
    const inspected = await execute(tools, 'inspectTimeline', {}) as { timeline: Timeline };
    const effect = inspected.timeline.clips.find(clip => clip.effectPreset === 'quick-zoom-in')!;
    await execute(tools, 'configureTimedEffect', { clipId: effect.id, zoom: { direction: 'out', speed: 2 } });
    await expect(execute(tools, 'configureTimedEffect', { clipId: 'from', zoom: { amount: 2 } })).rejects.toThrow('timed FX');
    expect(() => tools.configureTimedEffect.inputSchema.parse({ clipId: effect.id, zoom: { speed: 0 } })).toThrow();
  }, initial, true);
  expect(result.timeline.clips.slice(0, initial.clips.length)).toEqual(result.backend!.seed.clips);
  expect(result.timeline.clips.at(-1)).toMatchObject({ effectPreset: 'quick-zoom-out', start: 1, duration: 2, zoom: { direction: 'out', amount: 2, speed: 2, centerX: .75, centerY: .5 } });
  expect(editorCapabilities().timedFX.find(item => item.preset === 'quick-zoom-in')?.controls).toContain('direction');
  await assertUndo(result);
});

test.each([
  {preset:'punch' as const,settings:{amount:1.6,speed:.5,centerX:.3,centerY:.7},change:{speed:2}},
])('$preset properties are available through actual agent tools and persist/undo without changing footage',async({preset,settings,change})=>{
  const result=await run(async tools=>{
    expect(()=>tools.addTimedEffect.inputSchema.parse({preset:'quick-zoom-in',zoom:{amount:2},punch:{amount:2}})).toThrow('match');
    await execute(tools,'addTimedEffect',{preset,start:1,duration:2,[preset]:settings});
    const inspected=await execute(tools,'inspectTimeline',{}) as {timeline:Timeline};
    const effect=inspected.timeline.clips.find(clip=>clip.effectPreset===preset)!;
    await execute(tools,'configureTimedEffect',{clipId:effect.id,[preset]:change});
    await expect(execute(tools,'configureTimedEffect',{clipId:'from',[preset]:change})).rejects.toThrow('timed FX');
    expect(()=>tools.configureTimedEffect.inputSchema.parse({clipId:effect.id,[preset]:{unsupported:1}})).toThrow();
  },initial,true);
  expect(result.timeline.clips.slice(0,initial.clips.length)).toEqual(result.backend!.seed.clips);
  expect(result.timeline.clips.at(-1)).toMatchObject({effectPreset:preset,start:1,duration:2,[preset]:{...settings,...change}});
  expect(result.timeline.clips.at(-1)!.motion!.length).toBeLessThanOrEqual(120);
  await assertUndo(result);
});

test('retired frame shrink is unavailable to the agent; clip visual fades preserve linked audio and share one undo',async()=>{
  const seed:Timeline={...initial,clips:initial.clips.map(c=>c.id==='from'?{...c,visualFade:{fadeIn:.2,fadeOut:.4},visualFadeTiming:{duration:5,offset:1}}:c)};
  const result=await run(async tools=>{
    expect(()=>tools.addTimedEffect.inputSchema.parse({preset:'frame-shrink'})).toThrow();
    expect(()=>tools.configureTimedEffect.inputSchema.parse({clipId:'from',preset:'frame-shrink'})).toThrow();
    expect(()=>tools.addTimedEffect.inputSchema.parse({preset:'flash',frameShrink:{size:.2}})).toThrow();
    expect(()=>tools.configureVisualFade.inputSchema.parse({clipId:'from'})).toThrow('Specify');
    expect(()=>tools.configureVisualFade.inputSchema.parse({clipId:'from',fadeIn:-1})).toThrow();
    await execute(tools,'configureVisualFade',{clipId:'from',fadeIn:.5});
    await execute(tools,'configureVisualFade',{clipId:'from',fadeOut:.75});
    await expect(execute(tools,'configureVisualFade',{clipId:'audio',fadeIn:.2})).rejects.toThrow('video or image');
    await expect(execute(tools,'configureVisualFade',{clipId:'from',fadeOut:3})).rejects.toThrow('cannot exceed');

  },seed,true);
  expect(result.timeline.clips[0]).toEqual({...result.backend!.seed.clips[0],visualFade:{fadeIn:.5,fadeOut:.75},visualFadeTiming:undefined});
  expect(result.timeline.clips.slice(1,4)).toEqual(result.backend!.seed.clips.slice(1,4));
  expect(result.timeline.clips).toHaveLength(result.backend!.seed.clips.length);
  expect(editorCapabilities().timedFX.some(item=>String(item.preset)==='frame-shrink')).toBe(false);
  expect(editorCapabilities().effects.flatMap(group=>group.items).some(item=>item.name==='Frame shrink')).toBe(false);
  expect(editorCapabilities().visual.fades.description).toContain('independently');
  expect(result.calls).not.toContain('assistant:requestAnalysis');await assertUndo(result);
});

test('Punch timing tools preserve legacy controls, merge partial seconds and save one undo group',async()=>{
  const old={amount:1.6,speed:.5,centerX:.3,centerY:.7};
  const seed=patchClip(addEffectClip(initial,'legacy-punch','punch',1,{duration:2}),'legacy-punch',{punch:old});
  const result=await run(async tools=>{
    for(const field of ['attack','release'])for(const value of [.009,30.01,NaN,Infinity]){
      expect(()=>tools.addTimedEffect.inputSchema.parse({preset:'punch',punch:{[field]:value}})).toThrow();
      expect(()=>tools.configureTimedEffect.inputSchema.parse({clipId:'legacy-punch',punch:{[field]:value}})).toThrow();
    }
    expect(()=>tools.addTimedEffect.inputSchema.parse({preset:'punch',duration:.5,punch:{attack:30,release:30}})).not.toThrow();
    const read=async(id:string)=>((await execute(tools,'inspectTimeline',{})) as{timeline:Timeline}).timeline.clips.find(clip=>clip.id===id)!;
    expect((await read('legacy-punch')).punch).toEqual(old);
    await execute(tools,'configureTimedEffect',{clipId:'legacy-punch',punch:{attack:.25}});
    expect((await read('legacy-punch')).punch).toEqual({...old,attack:.25});
    await execute(tools,'configureTimedEffect',{clipId:'legacy-punch',punch:{release:.8}});
    expect((await read('legacy-punch')).punch).toEqual({...old,attack:.25,release:.8});
    await execute(tools,'addTimedEffect',{preset:'punch',start:4,duration:.5,punch:{amount:1.8,speed:2,centerX:.2,centerY:.6,attack:30,release:30}});
    const timeline=(await execute(tools,'inspectTimeline',{}) as{timeline:Timeline}).timeline,newEffect=timeline.clips.find(clip=>clip.effectPreset==='punch'&&clip.id!=='legacy-punch')!;
    await execute(tools,'configureTimedEffect',{clipId:newEffect.id,punch:{attack:.01}});
    expect((await read(newEffect.id)).punch).toEqual({amount:1.8,speed:2,centerX:.2,centerY:.6,attack:.01,release:30});
  },seed,true);
  expect(result.error).toBeUndefined();expect(result.timeline.clips.slice(0,initial.clips.length)).toEqual(result.backend!.seed.clips.slice(0,initial.clips.length));await assertUndo(result);
});

test('film and whole-clip blur agent controls save and retain source/audio; retired distortions are not offered',async()=>{
  const result=await run(async tools=>{
    for(const retired of ['lensDistortion','frameDistortion','directionalBlur']){const parsed=tools.setVisualEffects.inputSchema.safeParse({clipId:'from',[retired]:{enabled:true}});expect(parsed.success&&retired in (parsed.data as object)).toBe(false);}
    expect(()=>tools.setVisualEffects.inputSchema.parse({clipId:'from',filmOverlay:{grain:-1}})).toThrow();
    await execute(tools,'setVisualEffects',{clipId:'from',filmOverlay:{enabled:true,grain:.4},softBlur:{enabled:true,amount:12}});
    const current=await execute(tools,'inspectTimeline',{}) as{timeline:Timeline};
    expect(current.timeline.clips[0]).toMatchObject({filmOverlay:{enabled:true,grain:.4},softBlur:{enabled:true,amount:12}});
    await execute(tools,'resetVisualEffect',{clipId:'from',effect:'filmOverlay',action:'remove'});
    await expect(execute(tools,'setVisualEffects',{clipId:'audio',softBlur:{enabled:true,amount:5}})).rejects.toThrow('video or image');
  },initial,true);
  expect(result.timeline.clips[0]).toMatchObject({...result.backend!.seed.clips[0],softBlur:{enabled:true,amount:12}});
  expect(result.timeline.clips.slice(1)).toEqual(result.backend!.seed.clips.slice(1));
  expect(result.calls).not.toContain('assistant:requestAnalysis');await assertUndo(result);
});

test.each(['rgb-split','type-trails','blur-focus','character-scramble','spotlight-sweep','ink-write','tunnel-zoom'] as const)('%s animation tools preserve omitted controls, original clock, words and unrelated clips',async preset=>{
  const seed:Timeline={...initial,clips:initial.clips.map(clip=>clip.id==='title'?{...clip,textTemplate:{preset,strength:.7,revealDuration:1,stagger:.1,highlightColor:'#C4B5FD',duration:4,offset:.4}}:clip)};
  const result=await run(async tools=>{
    expect(()=>tools.applyTextTemplate.inputSchema.parse({clipId:'title',preset})).not.toThrow();
    expect(()=>tools.setTextAnimation.inputSchema.parse({clipId:'title',animation:preset})).not.toThrow();
    expect(()=>tools.configureTextTemplate.inputSchema.parse({clipId:'title'})).toThrow();
    for(const [control,values]of Object.entries({strength:[.19,2.01,NaN,Infinity],revealDuration:[.14,3.01,NaN,Infinity],stagger:[-.01,.19,NaN,Infinity]}))for(const value of values)expect(()=>tools.configureTextTemplate.inputSchema.parse({clipId:'title',[control]:value})).toThrow();
    await execute(tools,'configureTextTemplate',{clipId:'title',strength:1.4,revealDuration:.8});
    let current=await execute(tools,'inspectTimeline',{}) as{timeline:Timeline};
    expect(current.timeline.clips.find(clip=>clip.id==='title')!.textTemplate).toEqual({preset,strength:1.4,revealDuration:.8,stagger:.1,highlightColor:'#C4B5FD',duration:4,offset:.4});
    await execute(tools,'configureTextTemplate',{clipId:'title',preset,highlightColor:'#55CCFF',stagger:0});
    current=await execute(tools,'inspectTimeline',{}) as{timeline:Timeline};
    expect(current.timeline.clips.find(clip=>clip.id==='title')!.textTemplate).toEqual({preset,strength:1.4,revealDuration:.8,stagger:0,highlightColor:'#55CCFF',duration:4,offset:.4});
    await execute(tools,'applyTextTemplate',{clipId:'title',preset});
    await expect(execute(tools,'configureTextTemplate',{clipId:'from',strength:1})).rejects.toThrow('caption or text');
  },seed,true);
  expect(result.error).toBeUndefined();
  expect(result.timeline.clips.find(clip=>clip.id==='title')).toMatchObject({...seed.clips[3],textTemplate:{preset,strength:1.4,revealDuration:.8,stagger:0,highlightColor:'#55CCFF',duration:4,offset:.4}});
  expect(result.timeline.clips.filter(clip=>clip.id!=='title')).toEqual(result.backend!.seed.clips.filter(clip=>clip.id!=='title'));
  expect(result.calls).not.toContain('assistant:requestAnalysis');await assertUndo(result);
});

test('text template/color/rotation controls combine without changing words, source or timing',async()=>{
  const result=await run(async tools=>{
    await execute(tools,'styleTextClip',{clipId:'title',rotation:18,color:'#AABBCC',blendMode:'difference'});
    await execute(tools,'configureTextTemplate',{clipId:'title',highlightColor:'#FF5500'});
    await execute(tools,'applyMotionPreset',{clipId:'title',preset:'pop'});
  });
  expect(result.timeline.clips.find(clip=>clip.id==='from')).toEqual(initial.clips[0]);
  expect(result.timeline.clips.find(clip=>clip.id==='audio')).toEqual(initial.clips[1]);
  expect(result.timeline.clips.find(clip=>clip.id==='title')).toMatchObject({text:'Keep these words',start:0,duration:2,color:'#AABBCC',blendMode:'difference',transform:{rotation:18},textTemplate:{preset:'karaoke',duration:2,offset:0,highlightColor:'#FF5500'}});
  expect(result.timeline.clips.find(clip=>clip.id==='title')!.motion?.length).toBeGreaterThan(1);
  expect(result.calls).not.toContain('assistant:requestAnalysis');
});

test('text stroke/shadow/glow tools merge requested fields without touching content or independent motion',async()=>{
  const result=await run(async tools=>{
    expect(()=>tools.setTextStyle.inputSchema.parse({clipId:'title'})).toThrow();
    expect(()=>tools.setTextStyle.inputSchema.parse({clipId:'title',strokeWidth:21})).toThrow();
    expect(()=>tools.setTextStyle.inputSchema.parse({clipId:'title',shadowColor:'linear-gradient(red,blue)'})).toThrow();
    await expect(execute(tools,'setTextStyle',{clipId:'from',glowBlur:4})).rejects.toThrow('caption or text');
    await execute(tools,'setTextStyle',{clipId:'title',strokeWidth:4,strokeColor:'#102030',shadowBlur:18,shadowY:5,glowBlur:10});
    await execute(tools,'setTextStyle',{clipId:'title',glowBlur:0,shadowX:-7});
  });
  expect(result.timeline.clips.slice(0,3)).toEqual(initial.clips.slice(0,3));
  expect(result.timeline.clips[3]).toEqual({...initial.clips[3],textStyle:{...resolvedTextAppearance(initial.clips[3]),strokeWidth:4,strokeColor:'#102030',shadowBlur:18,shadowY:5,shadowX:-7,glowBlur:0}});
  expect(result.calls).not.toContain('assistant:requestAnalysis');
});

const captionSeed:Timeline={...initial,clips:[...initial.clips,{id:'second',kind:'caption',track:2,start:4,duration:2,sourceStart:0,text:'Different saved words',color:'#334455',animation:'rise'}]};
const audioSeed:Timeline={fps:30,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:2,effects:0},clips:[
  {id:'music',kind:'audio',assetId:'sound',track:2,start:1,duration:6,sourceStart:1,volume:.8},
  {id:'voice',kind:'audio',assetId:'sound',track:1,start:3,duration:2,sourceStart:2,volume:.3},
  {id:'untouched',kind:'caption',track:1,start:0,duration:2,sourceStart:0,text:'Untouched saved caption',color:'#abcdef'},
]};
async function assertUndo(result:Awaited<ReturnType<typeof run>>,before=result.backend!.seed){
  expect(result.error).toBeUndefined();expect(result.calls).not.toContain('assistant:requestAnalysis');
  expect(result.history).toEqual([before]);
  const store=createEditorStore(before);store.getState().edit(result.timeline);expect(store.getState().undo()).toEqual(before);expect(store.getState().redo()).toEqual(result.timeline);
  const revision=await result.backend!.owner.mutation(api.projects.undo,{projectId:result.backend!.projectId});
  expect((await result.backend!.owner.query(api.projects.get,{projectId:result.backend!.projectId})).timeline).toEqual(before);
  await result.backend!.owner.mutation(api.projects.saveTimeline,{projectId:result.backend!.projectId,timeline:result.timeline,expectedRevision:revision});
  expect((await result.backend!.owner.query(api.projects.get,{projectId:result.backend!.projectId})).timeline).toEqual(result.timeline);
}
test('all actual look/animation/font schemas exist; caption tools copy only appearance and preserve independent clocks',async()=>{
  const result=await run(async tools=>{
    for(const look of TEXT_LOOKS)expect(()=>tools.applyTextLook.inputSchema.parse({clipId:'title',look:look.id})).not.toThrow();
    for(const animation of TEXT_ANIMATION_PRESETS)expect(()=>tools.setTextAnimation.inputSchema.parse({clipId:'title',animation})).not.toThrow();
    for(const font of TEXT_FONTS){
      expect(()=>tools.styleTextClip.inputSchema.parse({clipId:'title',fontFamily:font.id})).not.toThrow();
      expect(()=>tools.styleCaptions.inputSchema.parse({fontFamily:font.id})).not.toThrow();
      expect(()=>tools.addCaption.inputSchema.parse({text:'Exact words',start:0,duration:2,fontFamily:font.id})).not.toThrow();
    }
    expect(()=>tools.styleTextClip.inputSchema.parse({clipId:'title',fontFamily:'arbitrary-css'})).toThrow();
    await execute(tools,'applyTextLook',{clipId:'title',look:'neon-echo'});
    await execute(tools,'styleTextClip',{clipId:'title',fontFamily:'anton',fontSize:80,color:'#AABBCC',rotation:18});
    const saved=await execute(tools,'setTextAnimation',{clipId:'title',animation:'word-reveal'});
    expect(saved).toMatchObject({saved:true,effectiveAnimation:'Word reveal'});
    await execute(tools,'applyCaptionStyle',{sourceClipId:'title',targetClipIds:['second']});
    await execute(tools,'styleCaptions',{clipIds:['second'],textStyle:{glowBlur:0}});
    await execute(tools,'setCaptionTiming',{clipId:'second',start:4.19,end:5.81});
  },captionSeed,true);
  expect(result.timeline.clips[3]).toMatchObject({text:initial.clips[3].text,start:0,duration:2,fontFamily:'anton',fontSize:80,color:'#AABBCC',transform:{rotation:18},textTemplate:{preset:'word-reveal'}});
  expect(result.timeline.clips.at(-1)).toMatchObject({text:'Different saved words',start:4.2,duration:expect.any(Number),fontFamily:'anton',color:'#AABBCC',animation:'rise',textAnimationTiming:{duration:2,offset:expect.any(Number)},textStyle:{glowBlur:0}});
  expect(result.timeline.clips.at(-1)!.duration).toBeCloseTo(1.6);expect(result.timeline.clips.at(-1)!.textTemplate).toBeUndefined();
  expect(result.timeline.clips.slice(0,3)).toEqual(result.backend!.seed.clips.slice(0,3));
  await assertUndo(result);
});
test('audio tools change only requested roles/fades/ducking and preserve source and music gain',async()=>{
  const result=await run(async tools=>{
    for(const role of AUDIO_ROLES)expect(()=>tools.configureAudio.inputSchema.parse({clipId:'music',role})).not.toThrow();
    expect(()=>tools.configureAudio.inputSchema.parse({clipId:'music',ducking:{}})).toThrow();
    await execute(tools,'configureAudio',{clipId:'voice',role:'voice'});
    await execute(tools,'configureAudio',{clipId:'music',role:'music',fadeIn:.5,fadeOut:.75,ducking:{enabled:true,amount:.6,attack:.2,release:.4}});
  },audioSeed,true);
  const music=result.timeline.clips[0];expect(music).toMatchObject({...result.backend!.seed.clips[0],audio:{role:'music',fadeIn:.5,fadeOut:.75,ducking:{enabled:true,amount:.6,attack:.2,release:.4}}});
  expect(result.timeline.clips[1]).toMatchObject({...result.backend!.seed.clips[1],audio:{role:'voice'}});expect(result.timeline.clips[2]).toEqual(result.backend!.seed.clips[2]);
  const lane=parseAutomation(audioVolumeEnvelope(result.timeline,music)).lanes[0];expect(sampleAutomationLane(lane,3)).toBeCloseTo(.32);expect(fadeGain(.25,6,audioSettings(music))).toBe(.5);
  await assertUndo(result);
});

test('saved transitions and FX retain the original cut through an agent linked split, then a broken cut is removed in one undo group',async()=>{
  let outgoingPiece='';
  const seed=addEffectClip(addTransitionClip(initial,'seed-crossfade','crossfade','from','to',{duration:1}),'seed-bars','cinematic-bars',2,{duration:2});
  const result=await run(async tools=>{
    await execute(tools,'split',{clipId:'from',time:1.5});
    const split=await execute(tools,'inspectTimeline',{}) as{timeline:Timeline};
    const retained=split.timeline.clips.find(clip=>clip.transition)!;
    outgoingPiece=retained.transition!.fromClipId;
    expect(outgoingPiece).not.toBe('from');
    expect(retained).toMatchObject({effectPreset:'crossfade',transition:{fromClipId:outgoingPiece,toClipId:'to'}});
    const outgoing=split.timeline.clips.find(clip=>clip.id===outgoingPiece)!;
    const sound=split.timeline.clips.find(clip=>clip.id===outgoing.linkedClipId)!;
    expect(outgoing).toMatchObject({start:1.5,duration:1.5,sourceStart:3.5});
    expect(sound).toMatchObject({start:1.5,duration:1.5,sourceStart:3.5,linkedClipId:outgoing.id});
    await execute(tools,'move',{clipId:'to',start:4});
  },seed,true);
  expect(result.timeline.clips.some(clip=>clip.transition)).toBe(false);
  expect(result.timeline.clips.find(clip=>clip.id==='to')).toMatchObject({start:4,duration:3,sourceStart:0});
  expect(result.timeline.clips.find(clip=>clip.id==='title')).toEqual(result.backend!.seed.clips[3]);
  expect(result.timeline.clips.find(clip=>clip.effectPreset==='cinematic-bars')).toMatchObject({start:2,duration:2});
  expect(result.timeline.clips.find(clip=>clip.id===outgoingPiece)?.duration).toBe(1.5);
  await assertUndo(result);
});

test('actual audio split and partial tools preserve sampled fade phase until a requested fade edit resets it',async()=>{
  let rightId='';
  const result=await run(async tools=>{
    await execute(tools,'configureAudio',{clipId:'music',role:'music',fadeIn:3,fadeOut:3});
    const before=await execute(tools,'inspectTimeline',{}) as{timeline:Timeline};
    const original=before.timeline.clips.find(clip=>clip.id==='music')!;
    await execute(tools,'split',{clipId:'music',time:4});
    const split=await execute(tools,'inspectTimeline',{}) as{timeline:Timeline};
    const left=split.timeline.clips.find(clip=>clip.id==='music')!;
    const right=split.timeline.clips.find(clip=>clip.kind==='audio'&&clip.start===4)!;
    rightId=right.id;
    expect(audioFadeAttributes(left)).toEqual({fadeIn:0,fadeOut:0});expect(audioFadeAttributes(right)).toEqual({fadeIn:0,fadeOut:0});
    for(const time of [3.9,4,4.1,5.5]){
      const child=time<4?left:right;
      expect(audioFadeGain(child,time-child.start)).toBeCloseTo(audioFadeGain(original,time-original.start),10);
    }
    await execute(tools,'configureAudio',{clipId:rightId,role:'original'});
    await execute(tools,'setVolume',{clipId:rightId,volume:.5});
    const partial=await execute(tools,'inspectTimeline',{}) as{timeline:Timeline};
    expect(partial.timeline.clips.find(clip=>clip.id===rightId)?.audioFadeTiming).toEqual({duration:6,offset:3});
    await execute(tools,'configureAudio',{clipId:rightId,fadeIn:.25});
  },audioSeed,true);
  expect(result.timeline.clips.find(clip=>clip.id===rightId)).toMatchObject({start:4,duration:3,sourceStart:4,volume:.5,audio:{role:'original',fadeIn:.25,fadeOut:3}});
  expect(result.timeline.clips.find(clip=>clip.id===rightId)?.audioFadeTiming).toBeUndefined();
  expect(result.timeline.clips.find(clip=>clip.id==='music')?.audioFadeTiming).toEqual({duration:6,offset:0});
  expect(result.timeline.clips.find(clip=>clip.id==='voice')).toEqual(result.backend!.seed.clips[1]);
  expect(result.timeline.clips.find(clip=>clip.id==='untouched')).toEqual(result.backend!.seed.clips[2]);
  await assertUndo(result);
});

function configuredModel(){
  let key:string;
  try{key=execFileSync(process.execPath,['node_modules/convex/bin/main.js','env','get','ANTHROPIC_API_KEY','--deployment','majestic-alpaca-541'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()}
  catch{throw new Error('Development Claude credential could not be read securely.')}
  expect(key.startsWith('sk-ant-')).toBe(true);
  return createAnthropic({apiKey:key})(CLAUDE_MODEL);
}
async function nativeIntent(prompt:string,seed:Timeline,priorHistory:Timeline[]=[],minimumToolCalls=2){
  const called:string[]=[],inputs:{name:string;input:unknown}[]=[];let finalText='';const model=configuredModel();
  const result=await run(async available=>{
    const tools=Object.fromEntries(Object.entries(available).map(([name,value])=>[name,tool({description:value.description,inputSchema:value.inputSchema,execute:async input=>{called.push(name);inputs.push({name,input});return execute(available,name,input)}})]));
    try{finalText=(await generateText({model,providerOptions:claudeProviderOptions(CLAUDE_MODEL),system:sdk.options!.instructions,prompt,tools,stopWhen:stepCountIs(8),maxOutputTokens:1800,abortSignal:AbortSignal.timeout(45000)})).text}
    catch(error){const cause=error as{statusCode?:number;name?:string};throw new Error(`Live Claude intent failed (${cause.name??'Error'}, status ${cause.statusCode??'unknown'}).`)}
  },seed,true,priorHistory);
  expect(result.error).toBeUndefined();expect(called).not.toContain('analyzeMedia');expect(called).not.toContain('inspectVideo');expect(called.length).toBeGreaterThanOrEqual(minimumToolCalls);
  return{...result,called,inputs,finalText};
}
test.skipIf(process.env.REVLINE_LIVE_AGENT_SMOKE!=='1')('live configured Claude uses actual pixel transform and crop inputs without moving media or audio timing',async()=>{
  const result=await nativeIntent('For video clip from only, use pixel units: center x960/y540 on the landscape1920x1080 reference canvas, scale1.25, rotation12degrees and opacity0.7. Crop intrinsic-source left96pixels, right192pixels and top54pixels using pixel units. Preserve all omitted controls, source ranges, linked audio and other clips. No analysis.',initial);
  expect(result.inputs.find(call=>call.name==='transformClip')?.input).toMatchObject({units:'pixels'});expect(result.inputs.find(call=>call.name==='cropClip')?.input).toMatchObject({units:'pixels'});
  expect(result.timeline.clips[0]).toEqual({...result.backend!.seed.clips[0],transform:{x:.5,y:.5,scale:1.25,rotation:12,opacity:.7},crop:{left:.05,right:.1,top:.05,bottom:0}});
  expect(result.timeline.clips.slice(1)).toEqual(result.backend!.seed.clips.slice(1));
  await assertUndo(result);
},60_000);
test.skipIf(process.env.REVLINE_LIVE_AGENT_SMOKE!=='1')('live configured Claude undoes, unlinks and removes CAD footage while preserving original audio',async()=>{
  const result=await nativeIntent('can u undo, unlink, leave audio, and delete footage of cad',trimmed,[initial]);
  expect(result.called).toContain('undoLatestEdit');expect(result.called).toContain('unlink');expect(result.called).toContain('delete');
  expect(result.called.indexOf('undoLatestEdit')).toBeLessThan(result.called.indexOf('unlink'));expect(result.called.indexOf('unlink')).toBeLessThan(result.called.indexOf('delete'));
  expect(result.timeline.clips.some(c=>c.id==='from')).toBe(false);
  expect(result.timeline.clips.find(c=>c.id==='audio')).toEqual({...result.backend!.priorHistory[0].clips[1],linkedClipId:undefined});
  expect(result.timeline.clips.filter(c=>c.id!=='audio')).toEqual(result.backend!.priorHistory[0].clips.slice(2));
  await assertUndo(result,result.backend!.priorHistory[0]);
  console.log(JSON.stringify({model:CLAUDE_MODEL,intent:'undo-unlink-keep-audio-delete-CAD-footage',actualToolCalls:result.called,originalAudioPreserved:true,oneNewUndo:true,syntheticOnly:true}));
},60_000);
test.skipIf(process.env.REVLINE_LIVE_AGENT_SMOKE!=='1')('live configured Claude finishes a staged deletion neutrally before the atomic server receipt',async()=>{
  const result=await nativeIntent('Delete only caption title. Preserve every other clip, original footage, linked audio, timing and controls. Do not analyze footage.',initial,[],1);
  expect(result.called).toContain('delete');expect(result.timeline.clips).toEqual(result.backend!.seed.clips.filter(c=>c.id!=='title'));
  expect(result.finalText.trim().length).toBeGreaterThan(0);expect(result.finalText).not.toMatch(/\bsaved\b|awaiting save|\bpending\b|\bprepared\b/i);
  const page=await result.backend!.owner.query(api.assistant.messages,{projectId:result.backend!.projectId,threadId:result.backend!.threadId,paginationOpts:{cursor:null,numItems:20}});
  expect(page.page.flatMap(m=>m.parts).filter(p=>p.type==='text').map(p=>p.providerMetadata?.revline?.publicationReceipt).filter(Boolean)).toEqual([{version:1,kind:'timeline-publication',status:'saved',runId:'run',threadId:result.backend!.threadId,promptMessageId:result.backend!.promptMessageId,stagedRevision:0,revision:1}]);
  await assertUndo(result);
  console.log(JSON.stringify({model:CLAUDE_MODEL,intent:'delete-caption-neutral-terminal-prose',actualToolCalls:result.called,finalText:result.finalText,atomicReceipt:true,otherClipsPreserved:true,oneUndo:true,syntheticOnly:true}));
},60_000);
test.skipIf(process.env.REVLINE_LIVE_AGENT_SMOKE!=='1')('live configured Claude applies look plus custom text and separate animation through stateful actual saves',async()=>{
  const result=await nativeIntent('For caption title only, first apply the Neon Echo look. Then customize it to Anton font, font size80, solid fill#AABBCC, rotation18degrees, stroke width3 with stroke color#102030, glow blur21 with glow color#2200AA, and Word reveal animation. Keep its exact existing words, start/duration and transparent background. Preserve every other clip and source. Do not analyze any media; this is an explicit text edit.',initial);
  const clip=result.timeline.clips[3];expect(clip).toMatchObject({text:initial.clips[3].text,start:0,duration:2,fontFamily:'anton',fontSize:80,color:'#AABBCC',background:'transparent',transform:{rotation:18},textStyle:{strokeWidth:3,strokeColor:'#102030',glowBlur:21,glowColor:'#2200AA'},textTemplate:{preset:'word-reveal'}});
  expect(result.timeline.clips.slice(0,3)).toEqual(result.backend!.seed.clips.slice(0,3));
  const frame=textLayerFrame({clip,index:3,fps:30,resolution:1080},.5,1920,1080);expect(frame.visible).toBe(true);expect(frame.style).toMatchObject({fontFamily:'Anton',fontSize:80,color:'#AABBCC'});
  await assertUndo(result);
  const directory=await mkdtemp(join(tmpdir(),'revline-native-agent-text-'));
  try{const path=join(directory,'timeline.json');await writeFile(path,JSON.stringify({before:result.backend!.seed,after:result.timeline}),{mode:0o600});const proof=execFileSync(process.execPath,['scripts/agent-text-intent-smoke.mjs'],{encoding:'utf8',env:{...process.env,REVLINE_AGENT_TEXT_FIXTURE:path},timeout:30000,stdio:['ignore','pipe','pipe']});expect(proof).toContain('PASS: actual native-intent text')}
  finally{await rm(directory,{recursive:true,force:true})}
  console.log(JSON.stringify({model:CLAUDE_MODEL,intent:'text-look-custom-animation',actualToolCalls:result.called,renderedPixels:true,oneUndo:true,syntheticOnly:true}));
},60_000);
test.skipIf(process.env.REVLINE_LIVE_AGENT_SMOKE!=='1')('live configured Claude configures music under voice and fades with actual native export ratios',async()=>{
  const result=await nativeIntent('Label audio clip voice as voice. For audio clip music, label it music, set fade in0.5seconds and fade out0.75seconds, and lower music under voice clips with ducking enabled, attenuation amount0.6, attack0.2seconds and release0.4seconds. Preserve both source ranges, timeline positions/durations, existing volumes, and the untouched caption. Do not analyze or transcribe; the role labels are explicit.',audioSeed);
  expect(result.timeline.clips[0]).toMatchObject({...result.backend!.seed.clips[0],audio:{role:'music',fadeIn:.5,fadeOut:.75,ducking:{enabled:true,amount:.6,attack:.2,release:.4}}});
  expect(result.timeline.clips[1]).toMatchObject({...result.backend!.seed.clips[1],audio:{role:'voice'}});expect(result.timeline.clips[2]).toEqual(result.backend!.seed.clips[2]);
  await assertUndo(result);
  const directory=await mkdtemp(join(tmpdir(),'revline-native-agent-audio-'));
  try{const path=join(directory,'timeline.json');await writeFile(path,JSON.stringify(result.timeline),{mode:0o600});const proof=execFileSync(process.execPath,['scripts/audio-settings-export-smoke.mjs'],{encoding:'utf8',env:{...process.env,REVLINE_AGENT_AUDIO_FIXTURE:path},timeout:30000,stdio:['ignore','pipe','pipe']});expect(proof).toContain('PASS: native HyperFrames')}
  finally{await rm(directory,{recursive:true,force:true})}
  console.log(JSON.stringify({model:CLAUDE_MODEL,intent:'voice-music-duck-fades',actualToolCalls:result.called,nativeExport:true,oneUndo:true,syntheticOnly:true}));
},60_000);

test.skipIf(process.env.REVLINE_LIVE_AGENT_SMOKE!=='1')('live configured Claude answers yo and abilities with zero tools and a bold list',async()=>{
  await run();
  const called:string[]=[],tools=Object.fromEntries(Object.entries(sdk.options!.tools).map(([name,value])=>[name,tool({description:value.description,inputSchema:value.inputSchema,execute:async()=>{called.push(name);return{blocked:true,message:'Synthetic smoke only; no media jobs or project writes.'}}})]));
  const settings={model:configuredModel(),providerOptions:claudeProviderOptions(CLAUDE_MODEL),system:sdk.options!.instructions,tools,stopWhen:stepCountIs(2),maxOutputTokens:768};
  try{
    const greeting=await generateText({...settings,prompt:'yo'});
    expect(greeting.text.trim().length).toBeGreaterThan(0);expect(called).toEqual([]);
    const abilities=await generateText({...settings,prompt:'What can you do with solid color frames/rectangles, dither palettes, combining text styles and animations, and clip-to-clip transitions?'});
    expect(called).toEqual([]);expect(abilities.text).toMatch(/^\s*[-*]\s+\*\*[^*]+\*\*/m);
    for(const capability of [/solid|rectangle/i,/dither/i,/text/i,/crossfade|spin|blur dissolve/i])expect(abilities.text).toMatch(capability);
    console.log(JSON.stringify({model:CLAUDE_MODEL,greetingTools:0,abilitiesTools:0,boldCapabilitiesList:true,syntheticOnly:true}));
  }catch(error){const cause=error as{statusCode?:number;name?:string};throw new Error(`Live Claude verification failed (${cause.name??'Error'}, status ${cause.statusCode??'unknown'}).`)}
},60_000);

test('timed effects require recorded expectations and refuse invented observed anchors',async()=>{
  const result=await run(async tools=>{
    await expect(tools.addTimedEffect.execute({},{preset:'flash',start:1,duration:.1})).rejects.toThrow('planEffects');
    await expect(tools.planEffects.execute({},{plans:[{id:'fake',kind:'timed',effect:'flash',start:1,duration:.1,purpose:'Emphasize a hit',strength:'Fixed preset',expectation:'Flash on contact',anchor:{kind:'observed-event',time:1,clipId:'from',evidenceId:'invented',description:'Unobserved punch'}}]})).rejects.toThrow('Inspect');
  });
  expect(result.timeline).toEqual(initial);expect(result.revision).toBe(0);
});


test('corner rounding is an independent clip setting and preserves distortion, footage and audio',async()=>{
  const seed:Timeline={...initial,clips:initial.clips.map(clip=>clip.id==='from'?{...clip,frameDistortion:{enabled:false,horizontal:.2,vertical:0,skew:0}}:clip)};
  const result=await run(async tools=>{
    for(const amount of [-.01,1.01,NaN,Infinity])expect(()=>tools.setVisualEffects.inputSchema.parse({clipId:'from',frameCorners:{amount}})).toThrow();
    await execute(tools,'setVisualEffects',{clipId:'from',frameCorners:{enabled:true,amount:.4}});
    let current=await execute(tools,'inspectTimeline',{}) as{timeline:Timeline};
    expect(current.timeline.clips[0].frameCorners).toEqual({enabled:true,amount:.4});
    expect(current.timeline.clips[0].frameDistortion).toEqual(seed.clips[0].frameDistortion);
    await execute(tools,'setVisualEffects',{clipId:'from',frameCorners:{enabled:false}});
    current=await execute(tools,'inspectTimeline',{}) as{timeline:Timeline};
    expect(current.timeline.clips[0].frameCorners).toEqual({enabled:false,amount:.4});
    await expect(execute(tools,'setVisualEffects',{clipId:'audio',frameCorners:{enabled:true,amount:.4}})).rejects.toThrow('video or image');
    await execute(tools,'resetVisualEffect',{clipId:'from',effect:'frameCorners',action:'remove'});
  },seed,true);
  expect(result.timeline.clips).toEqual(result.backend!.seed.clips.map(clip=>clip.id==='from'?{...clip,frameCorners:undefined}:clip));
  expect(result.calls).not.toContain('assistant:requestAnalysis');await assertUndo(result);
});


test.each(['from','to'])('VHS tools merge, bypass, reset, remove and undo on %s while preserving footage and audio',async clipId=>{
  const styled:Timeline={...initial,clips:initial.clips.map(clip=>clip.id===clipId?{...clip,lensDistortion:{...DEFAULT_LENS_DISTORTION,enabled:true}}:clip)};
  const seed=addEffectClip(styled,'fx-blur','zoom-blur',1,{duration:1});
  const result=await run(async tools=>{
    expect(tools.setVisualEffects.description).toContain('VHS');
    for(const [control,[min,max]] of Object.entries(VISUAL_EFFECT_LIMITS.vhs))for(const value of [min-.01,max+.01,NaN,Infinity])expect(()=>tools.setVisualEffects.inputSchema.parse({clipId,vhs:{[control]:value}})).toThrow();
    for(const bad of ['audio','title','fx-blur']){
      await expect(execute(tools,'setVisualEffects',{clipId:bad,vhs:{enabled:true}})).rejects.toThrow('video or image');
      await expect(execute(tools,'resetVisualEffect',{clipId:bad,effect:'vhs',action:'reset'})).rejects.toThrow('visual footage');
    }
    await expect(execute(tools,'setVisualEffects',{clipId,vhs:{}})).rejects.toThrow('Specify');
    await execute(tools,'setVisualEffects',{clipId,vhs:{enabled:true,scanlines:.8}});
    const read=async()=>((await execute(tools,'inspectTimeline',{})) as{timeline:Timeline}).timeline.clips.find(clip=>clip.id===clipId)!;
    expect((await read()).vhs).toEqual({...DEFAULT_VHS,enabled:true,scanlines:.8});
    await execute(tools,'setVisualEffects',{clipId,vhs:{noise:.6,tracking:.4,speed:0}});
    await execute(tools,'setVisualEffects',{clipId,vhs:{enabled:false}});
    expect((await read()).vhs).toEqual({...DEFAULT_VHS,scanlines:.8,noise:.6,tracking:.4,speed:0});
    await execute(tools,'resetVisualEffect',{clipId,effect:'vhs',action:'reset'});
    expect((await read()).vhs).toEqual(DEFAULT_VHS);
    await execute(tools,'setVisualEffects',{clipId,vhs:{enabled:true,amount:.9}});
    await execute(tools,'resetVisualEffect',{clipId,effect:'vhs',action:'reset'});
    expect((await read()).vhs).toEqual({...DEFAULT_VHS,enabled:true});
    await execute(tools,'resetVisualEffect',{clipId,effect:'vhs',action:'remove'});expect((await read()).vhs).toBeUndefined();
  },seed,true);
  expect(result.error).toBeUndefined();expect(result.timeline.clips).toEqual(result.backend!.seed.clips.map(clip=>clip.id===clipId?{...clip,vhs:undefined}:clip));
  expect(result.calls).not.toContain('assistant:requestAnalysis');await assertUndo(result);
});

test('retired footage Light sweep cannot be enabled by the agent; saved settings and other sweep/leak features remain',async()=>{
  const saved={...DEFAULT_LIGHT_SWEEP,enabled:true,color:'#12ABCF',speed:0};
  const seed={...initial,clips:initial.clips.map(clip=>clip.id==='from'?{...clip,lightSweep:saved}:clip)};
  const result=await run(async tools=>{
    expect(()=>tools.setVisualEffects.inputSchema.parse({clipId:'from',lightSweep:{enabled:true}})).toThrow();
    expect(()=>tools.setVisualEffects.inputSchema.parse({clipId:'from',vhs:{enabled:true}})).not.toThrow();
    expect(()=>tools.applyTextTemplate.inputSchema.parse({clipId:'title',preset:'spotlight-sweep'})).not.toThrow();
    await execute(tools,'setVisualEffects',{clipId:'from',vhs:{enabled:true}});
  },seed,true);
  expect(result.error).toBeUndefined();expect(result.timeline.clips.find(clip=>clip.id==='from')?.lightSweep).toEqual(saved);
  await assertUndo(result);
});

const aeVisualCases=[
  {effect:'turbulentDisplace',defaults:DEFAULT_TURBULENT_DISPLACE,first:{enabled:true,amount:40},second:{scale:220,speed:0},expected:{...DEFAULT_TURBULENT_DISPLACE,enabled:true,amount:40,scale:220,speed:0}},
] as const;
test.each(aeVisualCases)('$effect AI control boundaries, partial edits, bypass/reset/remove and undo preserve video/image/audio',async({effect,defaults,first,second,expected})=>{
  for(const clipId of ['from','to']){
    const seed=addEffectClip(initial,'fx-blur','zoom-blur',1,{duration:1});
    const result=await run(async tools=>{
      for(const [control,[min,max]] of Object.entries(VISUAL_EFFECT_LIMITS[effect]))for(const value of [min-.01,max+.01,NaN,Infinity])expect(()=>tools.setVisualEffects.inputSchema.parse({clipId,[effect]:{[control]:value}})).toThrow();
      await expect(execute(tools,'setVisualEffects',{clipId,[effect]:{}})).rejects.toThrow('Specify');
      for(const bad of ['audio','title','fx-blur']){
        await expect(execute(tools,'setVisualEffects',{clipId:bad,[effect]:{enabled:true}})).rejects.toThrow('video or image');
        await expect(execute(tools,'resetVisualEffect',{clipId:bad,effect,action:'reset'})).rejects.toThrow('visual footage');
      }
      const read=async()=>((await execute(tools,'inspectTimeline',{})) as{timeline:Timeline}).timeline.clips.find(clip=>clip.id===clipId)!;
      await execute(tools,'setVisualEffects',{clipId,[effect]:first});expect(await read()).toMatchObject({[effect]:{...defaults,...first}});
      await execute(tools,'setVisualEffects',{clipId,[effect]:second});expect(await read()).toMatchObject({[effect]:expected});
      await execute(tools,'setVisualEffects',{clipId,[effect]:{enabled:false}});expect(await read()).toMatchObject({[effect]:{...expected,enabled:false}});
      await execute(tools,'resetVisualEffect',{clipId,effect,action:'reset'});expect(await read()).toMatchObject({[effect]:defaults});
      await execute(tools,'setVisualEffects',{clipId,[effect]:{enabled:true}});await execute(tools,'resetVisualEffect',{clipId,effect,action:'reset'});expect(await read()).toMatchObject({[effect]:{...defaults,enabled:true}});
      await execute(tools,'resetVisualEffect',{clipId,effect,action:'remove'});
    },seed,true);
    expect(result.error).toBeUndefined();expect(result.timeline.clips).toEqual(result.backend!.seed.clips.map(clip=>clip.id===clipId?{...clip,[effect]:undefined}:clip));
    expect(result.calls).not.toContain('assistant:requestAnalysis');await assertUndo(result);
  }
});


test('a time-limited action checkpoints and continues the same request with one undo group',async()=>{
  const first=await run(async tools=>{
    await execute(tools,'trim',{clipId:'from',duration:1.5});
    throw new AssistantBudgetError('total');
  },initial,true);
  expect(first.outcome).toEqual({segment:1,savedEdits:1});
  expect(first.error).toBeUndefined();
  expect(first.calls).not.toContain('assistant:finish');
  expect((await first.backend!.owner.query(api.projects.get,{projectId:first.backend!.projectId})).aiRunning).toBe(true);
  const second=await run(async tools=>{
    await expect(execute(tools,'editText',{clipId:'title',text:'Continue'})).rejects.toThrow('Inspect the current timeline');
    await execute(tools,'inspectTimeline',{});
    await execute(tools,'editText',{clipId:'title',text:'Continue'});
  },initial,true,[],{backend:first.backend,continuation:first.outcome as{segment:number;savedEdits:number}});
  expect(second.error).toBeUndefined();
  expect(second.outcome).toBeNull();
  expect(second.timeline.clips.find(c=>c.id==='from')?.duration).toBe(1.5);
  expect(second.timeline.clips.find(c=>c.id==='title')?.text).toBe('Continue');
  expect(second.history).toHaveLength(1);
  expect(second.history[0]).toEqual(first.backend!.seed);
  expect((await second.backend!.owner.query(api.projects.get,{projectId:second.backend!.projectId})).aiRunning).toBe(false);
});

test('automatic continuation is bounded and leaves recovery when its final segment expires',async()=>{
  const result=await run(async()=>{throw new AssistantBudgetError('total')},initial,false,[],{continuation:{segment:2,savedEdits:4}});
  expect(result.outcome).toBeNull();
  expect(result.error).toContain('total time limit');
  expect(result.calls).toContain('assistant:finish');
});


test('the durable workflow executes checkpointed actions serially and settles the same request',async()=>{
  vi.useFakeTimers();
  try{
    const b=await memoryBackend(initial);workflowTest.register(b.t);
    let segments=0;
    sdk.plan=async()=>{
      const tools=sdk.options!.tools;
      segments++;
      await execute(tools,'inspectTimeline',{});
      if(segments===1){await execute(tools,'trim',{clipId:'from',duration:1.5});throw new AssistantBudgetError('total');}
      await execute(tools,'editText',{clipId:'title',text:'Finished after continuation'});
    };
    const workflowId=await b.t.run(ctx=>mediaWorkflow.start(ctx,internal.assistantWorkflow.run,{...b.runArgs,threadId:b.threadId,promptMessageId:b.promptMessageId},{startAsync:true,onComplete:internal.assistantWorkflow.settle,context:b.runArgs}));
    await b.t.run(ctx=>writeProject(ctx,b.projectId,{aiWorkflowId:workflowId}));
    for(let i=0;i<50;i++){
      vi.advanceTimersByTime(250);
      await b.t.finishInProgressScheduledFunctions();
      if(!(await b.owner.query(api.projects.get,{projectId:b.projectId})).aiRunning)break;
    }
    const result=await b.owner.query(api.projects.get,{projectId:b.projectId});
    expect(segments).toBe(2);
    expect(result.aiRunning).toBe(false);
    expect(result.aiError).toBeUndefined();
    expect(result.timeline?.clips.find(c=>c.id==='from')?.duration).toBe(1.5);
    expect(result.timeline?.clips.find(c=>c.id==='title')?.text).toBe('Finished after continuation');
    expect(result.history).toHaveLength(1);
  }finally{vi.useRealTimers();}
});


test('AI composes custom text settings without selecting a look and preserves words/timing',async()=>{
  const result=await run(async tools=>{
    await execute(tools,'styleTextClip',{clipId:'title',fontFamily:'fraunces',textStyle:{fontWeight:600,italic:true,letterSpacing:2,lineHeight:1.3,textAlign:'left',paddingX:24,paddingY:12,borderRadius:6}});
    await execute(tools,'setTextStyle',{clipId:'title',letterSpacing:3,shadowBlur:14,shadowColor:'#112233'});
  },initial,true);
  expect(result.error).toBeUndefined();
  const title=result.timeline.clips.find(c=>c.id==='title')!;
  expect(title).toMatchObject({fontFamily:'fraunces',text:initial.clips[3].text,start:0,duration:2,textStyle:{fontWeight:600,italic:true,letterSpacing:3,lineHeight:1.3,textAlign:'left',paddingX:24,paddingY:12,borderRadius:6,shadowBlur:14,shadowColor:'#112233'}});
  expect(result.calls).not.toContain('assistant:requestAnalysis');expect(result.calls).not.toContain('compositionReview:savePlan');
  await assertUndo(result);
});

test('AI Two rows preset uses the same framing operation as the inspector without changing audio or timing',async()=>{
  const seed:Timeline={...initial,tracks:{...initial.tracks!,visual:3},clips:initial.clips.map(clip=>clip.id==='to'?{...clip,kind:'video',assetId:'video',track:3,start:0,duration:3}:clip)};
  const result=await run(async tools=>{
    await execute(tools,'applyLayout',{layout:'two-rows',topClipIds:['from'],bottomClipIds:['to']});
  },seed,true);
  expect(result.error).toBeUndefined();
  for(const [id,y]of [['from',.25],['to',.75]] as const){const clip=result.timeline.clips.find(c=>c.id===id)!;expect(clip).toMatchObject({fit:'contain',transform:{x:.5,y}});const before=result.backend!.seed.clips.find(c=>c.id===id)!;expect([clip.start,clip.duration,clip.sourceStart,clip.volume]).toEqual([before.start,before.duration,before.sourceStart,before.volume]);}
  expect(result.timeline.clips.find(c=>c.id==='audio')).toEqual(result.backend!.seed.clips.find(c=>c.id==='audio'));
  expect(result.calls).not.toContain('assistant:requestAnalysis');await assertUndo(result);
});
