import { expect,test } from 'vitest';
import { validateEffectPlan,effectDisabledReference,checkPlanTiming,type EffectPlan } from './edit-plan';
import { compositionSampleTimes,pixelDifference,parseCompositionReview } from './composition-review';
import type { Timeline } from '../editor/types';
const timeline:Timeline={fps:30,aspectRatio:'landscape',clips:[{id:'video',kind:'video',assetId:'asset',start:0,duration:3,sourceStart:10}],markers:[{id:'hit',time:1}]};
const plan:EffectPlan={id:'impact',kind:'timed',effect:'punch',start:1,duration:.4,peak:1.2,purpose:'Emphasize the impact',strength:'Fixed 1.2× preset',expectation:'Peaks on contact then settles',anchor:{kind:'marker',markerId:'hit',time:1,description:'Requested beat'}};
test('checks real markers, cuts, supported controls and inspected evidence rather than invented events',()=>{
  expect(()=>validateEffectPlan([plan],timeline)).not.toThrow();
  expect(()=>validateEffectPlan([{...plan,anchor:{...plan.anchor,time:2}}],timeline)).toThrow('marker');
  const observed={...plan,anchor:{kind:'observed-event' as const,time:1.2,clipId:'video',evidenceId:'seen',description:'Visible lunge'}};
  expect(()=>validateEffectPlan([observed],timeline)).toThrow('Inspect');
  expect(()=>validateEffectPlan([observed],timeline,new Map([['seen',{clipIds:['video'],start:1,end:1.3}]]))).not.toThrow();
  expect(()=>validateEffectPlan([{...plan,effect:'invented'}],timeline)).toThrow('supported');
  expect(()=>validateEffectPlan([{...plan,peak:2}],timeline)).toThrow('peak');
});
test('reference disables only the planned effect and retains current source/timing/unrelated effects',()=>{
  const edited={...timeline,clips:[{...timeline.clips[0],sourceStart:12,glitch:{enabled:true,intensity:.2,blockSize:10,rgbSplit:3}},{id:'fx',kind:'effect' as const,effectPreset:'punch' as const,start:1,duration:.4,sourceStart:0},{id:'other',kind:'effect' as const,effectPreset:'flash' as const,start:2,duration:.1,sourceStart:0}]};
  const bound={...plan,outputClipId:'fx'};
  const reference=effectDisabledReference(edited,[bound],[timeline.clips[0]]);
  expect(reference.clips.map(clip=>clip.id)).toEqual(['video','other']);expect(reference.clips[0]).toEqual(edited.clips[0]);
  expect(checkPlanTiming(bound,edited).pass).toBe(true);expect(checkPlanTiming({...bound,outputClipId:'video'},edited).pass).toBe(false);
});
test('solid-color timing accepts visual color layers and legacy FX while rejecting a wrong target or range',()=>{
  const bound:EffectPlan={...plan,effect:'solid-color',outputClipId:'color'};
  for(const color of [{id:'color',kind:'solid' as const,start:1,duration:.4,sourceStart:0},{id:'color',kind:'effect' as const,effectPreset:'solid-color' as const,start:1,duration:.4,sourceStart:0}]){
    const edited={...timeline,clips:[...timeline.clips,color]};
    expect(checkPlanTiming(bound,edited).pass).toBe(true);
    expect(checkPlanTiming({...bound,start:1.2},edited).pass).toBe(false);
    expect(checkPlanTiming({...bound,duration:.8},edited).pass).toBe(false);
    expect(checkPlanTiming({...bound,effect:'punch'},edited).pass).toBe(false);
  }
});
test('samples are bounded and truthful numeric/vision receipts cannot invent extra plans',()=>{
  const times=compositionSampleTimes([plan],30,.9,1.5);expect(times.length).toBeLessThanOrEqual(12);expect(times.every(time=>time>=.9&&time<1.5)).toBe(true);
  const distinct={...plan,anchor:{...plan.anchor,time:1.1},peak:1.3};
  const paired=compositionSampleTimes([distinct,{...distinct,id:'second',start:2,peak:2.3,anchor:{...distinct.anchor,time:2.1}}],30,.9,2.5);
  expect(paired).toEqual(expect.arrayContaining([1.1,1.3,2.1,2.3]));expect(paired.length).toBeLessThanOrEqual(12);
  expect(pixelDifference(new Uint8Array([0,255]),new Uint8Array([0,0]))).toBe(.5);
  expect(()=>parseCompositionReview(JSON.stringify({observations:[{planId:'other',verdict:'pass',evidence:'Looks good'}],uncertainty:''}),[plan])).toThrow('exactly');
});

test('tool JSON schema exposes per-kind supported effects before invocation', async () => {
  const { effectPlanInput, EFFECT_PLAN_EFFECTS } = await import('./edit-plan');
  const { z } = await import('zod');
  const schema = z.toJSONSchema(effectPlanInput) as unknown as { anyOf: { properties: { kind: { const: string }; effect: { enum: string[] } } }[] };
  expect(schema.anyOf).toHaveLength(4);
  for (const branch of schema.anyOf) expect(branch.properties.effect.enum).toEqual(EFFECT_PLAN_EFFECTS[branch.properties.kind.const as keyof typeof EFFECT_PLAN_EFFECTS]);
  expect(effectPlanInput.safeParse({ ...plan, kind: 'text', effect: 'Bold numbered instruction' }).success).toBe(false);
  expect(effectPlanInput.safeParse({ ...plan, kind: 'text', effect: 'text-style' }).success).toBe(false);
  expect(effectPlanInput.safeParse({ ...plan, kind: 'timed', effect: 'stroke' }).success).toBe(false);
  expect(effectPlanInput.safeParse({ ...plan, kind: 'text', effect: 'stroke' }).success).toBe(true);
});
