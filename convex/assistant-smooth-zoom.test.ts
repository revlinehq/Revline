import {getFunctionName}from'convex/server';
import {afterEach,beforeEach,expect,test,vi}from'vitest';
import type{Timeline}from'../lib/editor/types';
import {parseFrameInspection}from'../lib/media-analysis/frame-inspection';
import {motionAt}from'../lib/editor/clip-effects';
const fixture=vi.hoisted(()=>({generate:undefined as undefined|((tools:Record<string,{inputSchema:{parse:(input:unknown)=>unknown};execute:(ctx:unknown,input:unknown)=>Promise<unknown>}>)=>Promise<void>)}));
vi.mock('@convex-dev/agent',async original=>({...await original<Record<string,unknown>>(),createTool:(options:unknown)=>options,saveMessage:async()=>null,Agent:class{
 constructor(_component:unknown,private options:{tools:Parameters<NonNullable<typeof fixture.generate>>[0]}){}
 async streamText(){await fixture.generate!(this.options.tools);return{finishReason:Promise.resolve('stop'),steps:Promise.resolve([])};}
}}));
import {respond}from'./assistantActions';
beforeEach(()=>{vi.stubEnv('OPENAI_API_KEY','fixture-only');vi.stubEnv('EDITOR_ENFORCE_TOKEN_BUDGET','false');vi.stubEnv('MODEL_SWITCHER_ENABLED','false');vi.stubEnv('AI_COST_DASHBOARD_ENABLED','false');});
afterEach(()=>vi.unstubAllEnvs());
const evidence=parseFrameInspection(JSON.stringify({summary:'Upload modal visible',uncertainty:'A single sampled instant',frames:[{frameIndex:300,observation:'Modal visible in upper right'}],events:[],targets:[{frameIndex:300,label:'Upload modal',confidence:'high',box:{left:.65,top:.15,right:.85,bottom:.35}}]}),{start:10,end:10.1,question:'Locate the Upload modal for a zoom'},[{frameIndex:300,time:10}],30,{sourceWidth:1920,sourceHeight:1080,decodedWidth:960,decodedHeight:540});
async function run(exercise:NonNullable<typeof fixture.generate>){
 let timeline:Timeline={fps:30,aspectRatio:'landscape',clips:[{id:'video',assetId:'source',kind:'video',start:8,duration:3,sourceStart:10,playbackRate:2,fit:'contain',linkedClipId:'audio'},{id:'audio',assetId:'audio-source',kind:'audio',start:8,duration:3,sourceStart:10,playbackRate:2,linkedClipId:'video'}]};
 const original=structuredClone(timeline);let revision=3,writes=0,analysis=0,error:string|undefined;
 fixture.generate=exercise;
 const ctx={
  runQuery:async(ref:Parameters<typeof getFunctionName>[0])=>{
   switch(getFunctionName(ref)){
    case'assistant:getRun':return{project:{timeline,revision,aspectRatio:timeline.aspectRatio},assets:[{_id:'source',ownerId:'owner',projectId:'project',kind:'video',fileName:'fixture.mp4',duration:30,width:1920,height:1080}]};
    case'assistant:currentPrompt':return'Zoom into the Upload modal smoothly and return.';
    case'assistant:isRunActive':return true;
    case'assistant:analysisRequest':return{status:'completed',frameInspection:evidence};
    default:throw new Error('Unexpected query');
   }
  },
  runMutation:async(ref:Parameters<typeof getFunctionName>[0],args:{timeline:Timeline;error?:string})=>{
   switch(getFunctionName(ref)){
    case'assistant:requestAnalysis':analysis++;return'request';
    case'assistant:clearAnalysis':case'assistant:beginEditing':return null;
    case'assistant:apply':writes++;timeline=args.timeline;return++revision;
    case'assistant:finish':error=args.error;return null;
    default:throw new Error('Unexpected mutation');
   }
  },
 };
 await(respond as unknown as{_handler:(ctx:unknown,args:unknown)=>Promise<unknown>})._handler(ctx,{projectId:'project',ownerId:'owner',runId:'run',threadId:'thread',promptMessageId:'prompt',pinnedModel:{provider:'openai',modelId:'gpt-6.1-sol',modelChoice:'gpt-6.1-sol'}});
 return{timeline,original,revision,writes,analysis,error};
}
const recipe={clipId:'video',start:8,inDuration:.6,holdDuration:1,outDuration:.6,scale:1.8,easing:'ease-in-out'};
test('actual inspectFrames targetId drives one saved zoom with canonical preview/export motion',async()=>{
 const result=await run(async tools=>{
  const inspection=await tools.inspectFrames.execute({},tools.inspectFrames.inputSchema.parse({assetId:'source',...evidence})) as{targets:{targetId:string}[]};
  expect(inspection.targets[0].targetId).toBeTruthy();
  const input=tools.configureSmoothZoom.inputSchema.parse({...recipe,focus:{kind:'target',targetId:inspection.targets[0].targetId}});
  expect(await tools.configureSmoothZoom.execute({},input)).toMatchObject({saved:true,staged:false,revision:4});
 });
 expect(result.error).toBeUndefined();expect(result.writes).toBe(1);expect(result.analysis).toBe(1);
 expect(result.timeline.clips[0].smoothZoom).toMatchObject({start:0,centerX:.75,centerY:.25});
 expect(motionAt(result.timeline.clips[0].motion!,.6).scale).toBeCloseTo(1.8);
 expect(motionAt(result.timeline.clips[0].motion!,2.2).scale).toBeCloseTo(1);
 expect(result.timeline.clips[1]).toEqual(result.original.clips[1]);
});
test('generic centered zoom needs no analysis and failed or previous-run targetIDs cannot modify the timeline',async()=>{
 const result=await run(async tools=>{
  const tool=tools.configureSmoothZoom;
  await expect(tool.execute({},tool.inputSchema.parse({...recipe,focus:{kind:'target',targetId:'old-or-guessed'}}))).rejects.toThrow('Inspect');
  expect(await tool.execute({},tool.inputSchema.parse({...recipe,outDuration:0,focus:{kind:'center'}}))).toMatchObject({saved:true,revision:4});
 });
 expect(result.error).toBeUndefined();expect(result.writes).toBe(1);expect(result.analysis).toBe(0);
 expect(motionAt(result.timeline.clips[0].motion!,2.9).scale).toBe(1.8);
});
