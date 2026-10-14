/// <reference types="vite/client" />
import { beforeEach,afterEach,expect,test,vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import {api,internal} from './_generated/api';
import { getFunctionName } from 'convex/server';
import type { Timeline } from '../lib/editor/types';
import { TIMED_EFFECT_PRESETS } from '../lib/editor/clip-effects';
import { editorCapabilities } from '../lib/ai/editor-capabilities';
import { resolvedTextAppearance } from '../lib/editor/text-style';
import { AUDIO_ROLES,audioSettings,audioVolumeEnvelope,audioFadeGain,audioFadeAttributes } from '../lib/editor/audio-settings';
import { TEXT_ANIMATION_PRESETS } from '../lib/editor/text-effects';
import { TEXT_LOOKS } from '../lib/editor/text-looks';
import { createEditorStore } from '../lib/editor/store';
import { textLayerFrame } from '../lib/editor/text-layers';
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
const sdk=vi.hoisted(()=>({options:null as null|{instructions:string;tools:Record<string,Tool>},plan:async()=>{},messages:[] as unknown[]}));
vi.mock('@convex-dev/agent',async importOriginal=>({
  ...await importOriginal<Record<string,unknown>>(),
  Agent:class{constructor(_component:unknown,options:NonNullable<typeof sdk.options>){sdk.options=options}async streamText(){await sdk.plan();return{finishReason:Promise.resolve('stop'),steps:Promise.resolve([])}}},
  createTool:(options:unknown)=>options,saveMessage:async(_ctx:unknown,_component:unknown,message:unknown)=>{sdk.messages.push(message)},stepCountIs:()=>()=>false,
}));
import { respond } from './assistantActions';

const initial:Timeline={fps:30,aspectRatio:'landscape',tracks:{visual:2,overlay:0,audio:1,effects:0},clips:[
  {id:'from',kind:'video',assetId:'video',track:1,start:0,duration:3,sourceStart:2,volume:0,audioSeparated:true,linkedClipId:'audio'},
  {id:'audio',kind:'audio',assetId:'sound',track:1,start:0,duration:3,sourceStart:2,volume:.6,linkedClipId:'from'},
  {id:'to',kind:'image',assetId:'image',track:1,start:3,duration:3,sourceStart:0},
  {id:'title',kind:'caption',track:2,start:0,duration:2,sourceStart:0,text:'Keep these words',animation:'fade',color:'#ffffff',background:'transparent',textTemplate:{preset:'karaoke',duration:2,offset:0,highlightColor:'#FFFF00'}},
]};
beforeEach(()=>{sdk.options=null;sdk.plan=async()=>{};sdk.messages=[];vi.stubEnv('BILLING_ENABLED','false')});
afterEach(()=>vi.unstubAllEnvs());
async function memoryBackend(seed:Timeline,priorHistory:Timeline[]=[]){
  const t=convexTest(schema,import.meta.glob('./**/*.ts')),owner=t.withIdentity({subject:'owner'});
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
  await t.run(ctx=>ctx.db.patch(projectId,{timeline,history,revision,aiRunning:true,aiRunId:'run',aiUndoRecorded:false}));
  return{t,owner,projectId,seed:timeline,priorHistory:history,revision,runArgs:{projectId,ownerId:'owner',runId:'run'}};
}
async function run(plan?:(tools:Record<string,Tool>)=>Promise<void>,seed:Timeline=initial,realBackend=false,priorHistory:Timeline[]=[]){
  const backend=realBackend?await memoryBackend(seed,priorHistory):undefined;
  let timeline=structuredClone(backend?.seed??seed),revision=backend?.revision??0,error:string|undefined;
  const calls:string[]=[];
  const project=()=>({_id:'project',timeline,revision,aspectRatio:'landscape'});
  const ctx={
    runQuery:async(reference:Parameters<typeof getFunctionName>[0],args:{timeline?:Timeline;expectedRevision?:number})=>{
      const name=getFunctionName(reference);calls.push(name);
      if(backend){
        if(name==='assistant:getRun')return backend.t.query(internal.assistant.getRun,backend.runArgs);
        if(name==='assistant:isRunActive')return backend.t.query(internal.assistant.isRunActive,backend.runArgs);
        if(name==='assistant:validateDraft')return backend.t.query(internal.assistant.validateDraft,{...backend.runArgs,timeline:args.timeline!,expectedRevision:args.expectedRevision!});
      }
      if(name==='assistant:getRun')return{project:project(),assets:[{_id:'video',kind:'video',fileName:'Own video',duration:30},{_id:'sound',kind:'audio',fileName:'Own audio',duration:30},{_id:'image',kind:'image',fileName:'Own image'}]};
      if(name==='assistant:isRunActive')return true;
      if(name==='assistant:validateDraft')return null;
      throw new Error('Unexpected query '+name);
    },
    runMutation:async(reference:Parameters<typeof getFunctionName>[0],args:{timeline?:Timeline;expectedRevision?:number;error?:string})=>{
      const name=getFunctionName(reference);calls.push(name);
      if(name==='assistant:undoLatestEdit'){
        if(!backend)throw new Error('Undo requires the in-memory saved backend.');
        const result=await backend.t.mutation(internal.assistant.undoLatestEdit,{...backend.runArgs,expectedRevision:args.expectedRevision!});timeline=structuredClone(result.timeline);revision=result.revision;return result;
      }
      if(name==='assistant:apply'){expect(args.expectedRevision).toBe(revision);timeline=structuredClone(args.timeline!);revision=backend?await backend.t.mutation(internal.assistant.apply,{...backend.runArgs,timeline,expectedRevision:revision}):revision+1;return revision}
      if(name==='assistant:finish'){error=args.error;return backend?backend.t.mutation(internal.assistant.finish,{...backend.runArgs,...(error?{error}:{})}):null}
      throw new Error('Unexpected mutation '+name);
    },
  };
  sdk.plan=async()=>{if(plan)await plan(sdk.options!.tools)};
  const handler=(respond as unknown as {_handler:(ctx:unknown,args:unknown)=>Promise<unknown>})._handler;
  await handler(ctx,{projectId:backend?.projectId??'project',ownerId:'owner',runId:'run',threadId:'thread',promptMessageId:'greeting-message',playhead:1});
  const history=backend?(await backend.owner.query(api.projects.get,{projectId:backend.projectId})).history??[]:[];
  return{timeline,revision,calls,history,error,backend};
}
const execute=(tools:Record<string,Tool>,name:string,input:unknown)=>tools[name].execute({},tools[name].inputSchema.parse(input));
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
  expect(staged.error).toContain('pending replacement was not saved');
  expect((await staged.backend!.owner.query(api.projects.get,{projectId:staged.backend!.projectId})).timeline).toEqual(staged.backend!.seed);
  expect(staged.history).toEqual([]);
});

test('group copy/move/trim, layer reorder and common blend use actual editor operations while preserving source identity',async()=>{
  const result=await run(async tools=>{
    await execute(tools,'addClipTransition',{preset:'crossfade',fromClipId:'from',toClipId:'to'});
    const current=await execute(tools,'inspectTimeline',{}) as{timeline:Timeline};
    const oldTransition=current.timeline.clips.find(c=>c.transition)!;
    const copied=await execute(tools,'duplicateClips',{clipIds:['from','to',oldTransition.id],at:6}) as{newClipIds:string[]};
    await execute(tools,'moveClips',{clipIds:copied.newClipIds,timeDelta:2,layerDelta:1});
    const moved=await execute(tools,'inspectTimeline',{}) as{timeline:Timeline};
    const pair=moved.timeline.clips.find(c=>copied.newClipIds.includes(c.id)&&c.transition)!;
    expect(pair.transition!.fromClipId).not.toBe('from');expect(pair.transition!.toClipId).not.toBe('to');
    await expect(execute(tools,'duplicateClips',{clipIds:[oldTransition.id],at:20})).rejects.toThrow('both connected clips');
    await expect(execute(tools,'setBlendMode',{clipIds:[pair.transition!.fromClipId],blendMode:'screen'})).rejects.toThrow('same blend');
    await execute(tools,'setBlendMode',{clipIds:[pair.transition!.fromClipId,pair.transition!.toClipId],blendMode:'screen'});
    await execute(tools,'resizeClips',{clipIds:[pair.transition!.fromClipId],side:'left',delta:.2});
    await execute(tools,'reorderLayer',{group:'visual',from:2,to:3});
    await execute(tools,'followSubject',{clipId:'from',enabled:false});
  },initial,true);
  const copies=result.timeline.clips.filter(c=>c.kind==='video'&&c.id!=='from');expect(copies).toHaveLength(1);
  const copy=copies[0],audio=result.timeline.clips.find(c=>c.id===copy.linkedClipId)!;
  expect(copy).toMatchObject({track:3,start:8.2,duration:2.8,sourceStart:2.2,blendMode:'screen',assetId:result.backend!.seed.clips[0].assetId});
  expect(audio).toMatchObject({start:8.2,duration:2.8,sourceStart:2.2,volume:.6,linkedClipId:copy.id});
  expect(result.timeline.clips.find(c=>c.id==='title')).toEqual({...result.backend!.seed.clips[3],track:3});
  expect(result.timeline.clips.find(c=>c.id==='to')).toEqual(result.backend!.seed.clips[2]);
  expect(result.timeline.clips.filter(c=>c.transition)).toHaveLength(2);
  await assertUndo(result);
});

test('a plain greeting completion creates no edits or analysis requests and preserves concise abilities policy',async()=>{
  const result=await run();
  expect(result.timeline).toEqual(initial);expect(result.revision).toBe(0);
  expect(result.calls).toEqual(['assistant:getRun','assistant:finish']);
  expect(sdk.options!.instructions).toContain('Greetings, small talk, and questions about your abilities do not request footage analysis or editing');
  expect(sdk.options!.instructions).toContain('short Markdown bullet list with bold capability names');
  expect(sdk.options!.instructions).toContain(JSON.stringify(editorCapabilities()));
});

test('every implemented effect, text animation/look and transition has a concrete shared behavior description',()=>{
  const catalog=editorCapabilities();
  for(const entry of [...catalog.effects.flatMap(category=>category.items),...catalog.timedFX,...catalog.transitions.items,...catalog.text.animations,...catalog.text.looks]){
    expect(entry.description.trim().length).toBeGreaterThan(20);expect(entry.description).not.toBe('Add at the playhead');
  }
  expect(catalog.text.animations).toHaveLength(TEXT_ANIMATION_PRESETS.length);expect(catalog.text.looks).toHaveLength(6);expect(catalog.transitions.items).toHaveLength(3);
  expect(catalog.text.animations.find(item=>item.preset==='karaoke')?.description).toContain('not detected');
  expect(catalog.visual.canvasReference.landscape).toEqual({width:1920,height:1080});expect(catalog.visual.canvasReference.vertical).toEqual({width:1080,height:1920});
});

test('pixel transform/crop tools use known canvas/source axes, preserve omitted fields and reject unknown/impossible geometry',async()=>{
  await run(async tools=>await expect(execute(tools,'cropClip',{clipId:'from',units:'pixels',left:96})).rejects.toThrow('Known positive'));
  const result=await run(async tools=>{
    await execute(tools,'transformClip',{clipId:'from',units:'pixels',x:960,y:540,scale:1.25,rotation:12,opacity:.7});
    await execute(tools,'cropClip',{clipId:'from',units:'pixels',left:96,right:192,top:54});
    await execute(tools,'cropClip',{clipId:'from',bottom:.1});
    await expect(execute(tools,'transformClip',{clipId:'from',units:'pixels',x:1921})).rejects.toThrow('supported range');
    await expect(execute(tools,'cropClip',{clipId:'from',units:'pixels',left:1824})).rejects.toThrow('more than 5%');
  },initial,true);
  expect(result.timeline.clips[0]).toEqual({...result.backend!.seed.clips[0],transform:{x:.5,y:.5,scale:1.25,rotation:12,opacity:.7},crop:{left:.05,right:.1,top:.05,bottom:.1}});
  expect(result.timeline.clips.slice(1)).toEqual(result.backend!.seed.clips.slice(1));
  await assertUndo(result);
});

test('every current timed FX has a tool schema, while transitions require explicit distinct clip targets',async()=>{
  await run(async tools=>{
    for(const preset of TIMED_EFFECT_PRESETS)expect(()=>tools.addTimedEffect.inputSchema.parse({preset})).not.toThrow();
    expect(()=>tools.addTimedEffect.inputSchema.parse({preset:'crossfade'})).toThrow();
    expect(()=>tools.addClipTransition.inputSchema.parse({preset:'crossfade',fromClipId:'from'})).toThrow();
    expect(()=>tools.addClipTransition.inputSchema.parse({preset:'spin-zoom',fromClipId:'from',toClipId:'to',direction:'diagonal'})).toThrow();
    await expect(execute(tools,'addClipTransition',{preset:'blur-dissolve',fromClipId:'from',toClipId:'from'})).rejects.toThrow('neighboring');
    await execute(tools,'addClipTransition',{preset:'blur-dissolve',fromClipId:'from',toClipId:'to',direction:'counter-clockwise',duration:.8});
  });
  expect(sdk.messages).toHaveLength(0);
});

test('solid color creation/configuration changes only the new FX rectangle and retains omitted controls',async()=>{
  const result=await run(async tools=>{
    await execute(tools,'addTimedEffect',{preset:'solid-color',start:1,duration:2,solidColor:{color:'#123456',width:.6,opacity:.8}});
    // Inspect exposes the actual saved ID; the tool never guesses or targets footage.
    const inspected=await execute(tools,'inspectTimeline',{}) as {timeline:Timeline};
    const rectangle=inspected.timeline.clips.find(clip=>clip.effectPreset==='solid-color')!;
    await execute(tools,'setSolidColor',{clipId:rectangle.id,x:.2,height:.4});
    await expect(execute(tools,'setSolidColor',{clipId:'from',color:'#abcdef'})).rejects.toThrow('solid color effect');
  });
  expect(result.timeline.clips.slice(0,initial.clips.length)).toEqual(initial.clips);
  expect(result.timeline.clips.at(-1)?.solidColor).toEqual({color:'#123456',width:.6,height:.4,x:.2,y:.5,opacity:.8});
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

test('cinematic bars size/speed and dither original-palette reset are independently editable',async()=>{
  const result=await run(async tools=>{
    await execute(tools,'addTimedEffect',{preset:'cinematic-bars',start:2,duration:2});
    const inspected=await execute(tools,'inspectTimeline',{}) as{timeline:Timeline};
    const bars=inspected.timeline.clips.find(clip=>clip.effectPreset==='cinematic-bars')!;
    await execute(tools,'configureTimedEffect',{clipId:bars.id,cinematicBars:{size:.2,speed:2}});
    await execute(tools,'configureTimedEffect',{clipId:bars.id,duration:3});
    await expect(execute(tools,'configureTimedEffect',{clipId:'from',duration:3})).rejects.toThrow('timed FX');
    await execute(tools,'setVisualEffects',{clipId:'from',dither:{enabled:true,levels:5,shadowColor:'#112233',highlightColor:'#abcdef'},invert:{enabled:true,amount:.3}});
    await execute(tools,'resetVisualEffect',{clipId:'from',effect:'dither',action:'original-colors'});
    await execute(tools,'resetVisualEffect',{clipId:'from',effect:'invert',action:'remove'});
  },initial,true);
  expect(result.timeline.clips.at(-1)).toMatchObject({start:2,duration:3,cinematicBars:{size:.2,speed:2}});
  expect(result.timeline.clips[0].dither).toMatchObject({enabled:true,levels:5});expect(result.timeline.clips[0].dither?.shadowColor).toBeUndefined();expect(result.timeline.clips[0].dither?.highlightColor).toBeUndefined();expect(result.timeline.clips[0].invert).toBeUndefined();
  expect(result.timeline.clips.slice(1,4)).toEqual(result.backend!.seed.clips.slice(1,4));
  await assertUndo(result);
});

test('dither palette and text template/color/rotation controls combine without changing words, source or timing',async()=>{
  const result=await run(async tools=>{
    await execute(tools,'setVisualEffects',{clipId:'from',dither:{enabled:true,shadowColor:'#101080',highlightColor:'#FFFF00',levels:3}});
    await execute(tools,'styleTextClip',{clipId:'title',rotation:18,color:'#AABBCC',blendMode:'difference'});
    await execute(tools,'configureTextTemplate',{clipId:'title',highlightColor:'#FF5500'});
    await execute(tools,'applyMotionPreset',{clipId:'title',preset:'pop'});
  });
  expect(result.timeline.clips.find(clip=>clip.id==='from')).toMatchObject({...initial.clips[0],dither:{enabled:true,shadowColor:'#101080',highlightColor:'#FFFF00',levels:3}});
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

test('actual transition and FX tools retain the original cut through linked split, then remove a broken cut in one undo group',async()=>{
  let outgoingPiece='';
  const result=await run(async tools=>{
    await execute(tools,'addClipTransition',{preset:'crossfade',fromClipId:'from',toClipId:'to',duration:.8});
    const before=await execute(tools,'inspectTimeline',{}) as{timeline:Timeline};
    const transition=before.timeline.clips.find(clip=>clip.transition)!;
    await execute(tools,'configureClipTransition',{clipId:transition.id,preset:'spin-zoom',direction:'counter-clockwise',duration:1});
    await execute(tools,'addTimedEffect',{preset:'cinematic-bars',start:2,duration:2});
    await execute(tools,'split',{clipId:'from',time:1.5});
    const split=await execute(tools,'inspectTimeline',{}) as{timeline:Timeline};
    const retained=split.timeline.clips.find(clip=>clip.transition)!;
    outgoingPiece=retained.transition!.fromClipId;
    expect(outgoingPiece).not.toBe('from');
    expect(retained).toMatchObject({start:2.5,duration:1,effectPreset:'spin-zoom',transition:{fromClipId:outgoingPiece,toClipId:'to',direction:'counter-clockwise'}});
    const outgoing=split.timeline.clips.find(clip=>clip.id===outgoingPiece)!;
    const sound=split.timeline.clips.find(clip=>clip.id===outgoing.linkedClipId)!;
    expect(outgoing).toMatchObject({start:1.5,duration:1.5,sourceStart:3.5});
    expect(sound).toMatchObject({start:1.5,duration:1.5,sourceStart:3.5,linkedClipId:outgoing.id});
    await execute(tools,'configureClipTransition',{clipId:transition.id,preset:'blur-dissolve'});
    await execute(tools,'move',{clipId:'to',start:4});
  },initial,true);
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
async function nativeIntent(prompt:string,seed:Timeline,priorHistory:Timeline[]=[]){
  const called:string[]=[],inputs:{name:string;input:unknown}[]=[];const model=configuredModel();
  const result=await run(async available=>{
    const tools=Object.fromEntries(Object.entries(available).map(([name,value])=>[name,tool({description:value.description,inputSchema:value.inputSchema,execute:async input=>{called.push(name);inputs.push({name,input});return execute(available,name,input)}})]));
    try{await generateText({model,providerOptions:claudeProviderOptions(CLAUDE_MODEL),system:sdk.options!.instructions,prompt,tools,stopWhen:stepCountIs(8),maxOutputTokens:1800,abortSignal:AbortSignal.timeout(45000)})}
    catch(error){const cause=error as{statusCode?:number;name?:string};throw new Error(`Live Claude intent failed (${cause.name??'Error'}, status ${cause.statusCode??'unknown'}).`)}
  },seed,true,priorHistory);
  expect(result.error).toBeUndefined();expect(called).not.toContain('analyzeMedia');expect(called).not.toContain('inspectVideo');expect(called.length).toBeGreaterThan(1);
  return{...result,called,inputs};
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
