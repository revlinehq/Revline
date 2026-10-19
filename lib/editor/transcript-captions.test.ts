import {completionRepairFeedback,hasFailedRenderChecks,hasUnresolvedToolFailures,hasOnlyUnresolvedInspectionFailures} from '../ai/tool-failures';
import type { EffectPlan } from '../ai/edit-plan';
import { expect, test } from 'vitest';
import { captionClipsFromTranscript, captionsCoverTranscript } from './transcript-captions';
import { validateRemotionTextTemplate } from './remotion-text';
import type { Clip } from './types';
const clip: Clip = { id: 'video', kind: 'video', assetId: 'source', start: 5, sourceStart: 10, duration: 10 };
const ids = () => { let id = 0; return () => `caption-${id++}`; };

test('retained words replace overlapping segment text and exclude partially cut words', () => {
  const transcript = { segments: [{ start: 9, end: 12, text: 'Removed half Keep this. Removed' }], words: [{ start: 9, end: 9.5, text: 'Removed' }, { start: 9.8, end: 10.1, text: 'half' }, { start: 10.2, end: 10.5, text: 'Keep' }, { start: 10.5, end: 11, text: 'this.' }, { start: 11.8, end: 12, text: 'Removed' }] };
  const before = structuredClone(transcript), result = captionClipsFromTranscript({ ...clip, duration: 1.5 }, transcript, 30, ids());
  expect(result.map(caption => caption.text)).toEqual(['Keep this.']);
  expect(result[0].start).toBeCloseTo(5.2, 10); expect(result[0].duration).toBeCloseTo(.8, 10);
  expect(() => validateRemotionTextTemplate(result[0])).not.toThrow();
  expect(transcript).toEqual(before);
});

test('phrases break at six words, sentence punctuation and audible gaps', () => {
  const words = Array.from({ length: 9 }, (_, index) => ({ start: 10 + index * .2, end: 10.1 + index * .2, text: index === 7 ? 'end.' : `word${index}` }));
  words.push({ start: 13, end: 13.2, text: 'Later.' });
  const result = captionClipsFromTranscript(clip, { words, segments: [] }, 30, ids());
  expect(result.map(caption => caption.text?.split(/\s+/).length)).toEqual([6, 2, 1, 1]);
  expect(result.map(caption => caption.text)).toEqual(['word0 word1 word2 word3 word4 word5', 'word6 end.', 'word8', 'Later.']);
  result.forEach(caption => expect(() => validateRemotionTextTemplate(caption)).not.toThrow());
});

test('instantaneous final words get one display frame within the retained clip and keep zero measured duration', () => {
  const result = captionClipsFromTranscript({ ...clip, duration: .1 }, { segments: [], words: [{ start: 10.095, end: 10.095, text: 'Yes.' }] }, 30, ids());
  expect(result).toHaveLength(1); expect(result[0].duration).toBeCloseTo(1 / 30, 10);
  expect(result[0].start + result[0].duration).toBeCloseTo(5.1, 10);
  expect(result[0].textTemplate!.wordTimings![0].start).toBeCloseTo(result[0].textTemplate!.wordTimings![0].end, 10);
  expect(() => validateRemotionTextTemplate(result[0])).not.toThrow();
});

test('an instantaneous word on a split belongs only to the following retained piece', () => {
  const transcript = { segments: [], words: [{ start: 11, end: 11, text: 'Yes.' }] };
  expect(captionClipsFromTranscript({ ...clip, duration: 1 }, transcript, 30, ids())).toEqual([]);
  expect(captionClipsFromTranscript({ ...clip, start: 6, sourceStart: 11, duration: 1 }, transcript, 30, ids())).toHaveLength(1);
});

test('segments without word evidence are captioned only when their complete text is retained', () => {
  const result = captionClipsFromTranscript({ ...clip, duration: 2 }, { words: [], segments: [{ start: 9, end: 11, text: 'Partially removed' }, { start: 11, end: 11.8, text: 'Fully retained' }] }, 30, ids());
  expect(result.map(caption => caption.text)).toEqual(['Fully retained']);
  expect(result[0].textTemplate).toBeUndefined();
});


test('a one-frame caption at a later timestamp survives strict server duration validation', () => {
  for (const fps of [24,30,60]) {
    const result=captionClipsFromTranscript({...clip,start:7.233331807454427}, {segments:[],words:[{start:10,end:10,text:'word'}]},fps,ids());
    expect(result).toHaveLength(1);
    expect(result[0].duration).toBeGreaterThanOrEqual(1/fps);
  }
});


test('manual caption fallback clears only its timing failure after complete source coverage and inspection',()=>{
  const transcript={words:[{start:10,end:11,text:'First.'},{start:12,end:13,text:'Second.'}],segments:[]};
  const footage={...clip,duration:3};
  const captions=captionClipsFromTranscript(footage,transcript,30,ids());
  const timeline={fps:30,aspectRatio:'landscape' as const,clips:[footage,...captions]};
  expect(captionsCoverTranscript(timeline,'source',transcript)).toBe(true);
  expect(captionsCoverTranscript({...timeline,clips:[footage,captions[0]]},'source',transcript)).toBe(false);
  expect(captionsCoverTranscript(timeline,'other',transcript)).toBe(false);
  const failed={content:[{type:'tool-call',toolName:'addSubtitlesFromTranscript',toolCallId:'automatic',input:{assetId:'source'}},{type:'tool-result',toolName:'addSubtitlesFromTranscript',toolCallId:'automatic',output:{type:'error-text',value:'ConvexError: Clip timing must be finite, nonnegative, and at least one frame long'}}]};
  const added={content:[{type:'tool-result',toolName:'addCaption',toolCallId:'manual',input:{text:'First.'},output:{saved:true,revision:1,changedClips:[captions[0]]}}]};
  const inspect=(ids:string[])=>({content:[{type:'tool-result',toolName:'inspectTimeline',output:{staged:false,revision:1,summary:{overlapCount:0,missingAssetRefs:[]},captionedAssetIds:ids}}]});
  expect(hasUnresolvedToolFailures([failed,added])).toBe(true);
  expect(hasUnresolvedToolFailures([failed,inspect(['source'])])).toBe(true);
  expect(hasUnresolvedToolFailures([failed,added,inspect(['other'])])).toBe(true);
  expect(hasUnresolvedToolFailures([failed,added,inspect(['source'])])).toBe(false);
  expect(hasUnresolvedToolFailures([failed,added,inspect(['source']),{content:[{type:'tool-error',toolName:'trim',toolCallId:'unrelated',error:'Source trim failed'}]}])).toBe(true);
});


test('a failed broad inspection with successful smaller checks remains an incomplete check, never an edit failure',()=>{
  const steps=[{content:[{type:'tool-result',toolName:'inspectVideo',input:{assetId:'source',start:0,end:20},output:{success:false,error:'The media analysis request was rejected.'}}]},{content:[{type:'tool-result',toolName:'inspectFrames',input:{assetId:'source',start:2,end:3},output:{success:true}}]}];
  expect(hasUnresolvedToolFailures(steps)).toBe(true);
  expect(hasOnlyUnresolvedInspectionFailures(steps)).toBe(true);
  expect(hasOnlyUnresolvedInspectionFailures([...steps,{content:[{type:'tool-error',toolName:'trim',error:'Source trim failed'}]}])).toBe(false);
});

const reviewPlan: EffectPlan = {
  id:'outline',kind:'text',effect:'stroke',targetClipId:'caption',purpose:'Keep the caption readable',strength:'Black outline',expectation:'The caption has a visible black outline',start:0,duration:1,
  anchor:{kind:'requested-time',time:0,description:'Requested caption'},checks:{textSafe:true},
};
const reviewContext={plans:[reviewPlan],revision:2};
const renderedReview=(output:Record<string,unknown>={},planIds=['outline'])=>({content:[{
  type:'tool-result',toolName:'previewRender',input:{planIds},output:{reviewed:true,stale:false,revision:2,currentRevision:2,sampleTimes:[0,.5,1],observations:planIds.map(planId=>({planId,verdict:'pass',evidence:'The requested outline is visible.'})),checks:planIds.map(planId=>({planId,timingPass:true,pixelPass:null,textSafe:true,returnPass:null})),...output},
}]});

test('ordinary saved trims and read-only inspections do not acquire an unrequested render requirement',()=>{
  const steps=[{content:[{type:'tool-result',toolName:'trim',output:{saved:true,revision:2,changedClips:[clip]}}]},{content:[{type:'tool-result',toolName:'inspectFrames',output:{success:true}}]}];
  expect(hasFailedRenderChecks(steps)).toBe(false);
  expect(completionRepairFeedback(steps,'stop')).toBeUndefined();
});

test('persisted effect expectations require a real completed review before finishing',()=>{
  expect(hasFailedRenderChecks([],reviewContext)).toBe(true);
  expect(completionRepairFeedback([],'stop',reviewContext)).toContain('outline');
  expect(hasFailedRenderChecks([renderedReview()],reviewContext)).toBe(false);
  expect(completionRepairFeedback([renderedReview()],'stop',reviewContext)).toBeUndefined();
});

test.each(['fail','unverifiable'])('a %s rendered observation remains unfinished even when measured checks pass',verdict=>{
  const steps=[renderedReview({observations:[{planId:'outline',verdict,evidence:'The outline could not be confirmed.'}]})];
  expect(hasFailedRenderChecks(steps,reviewContext)).toBe(true);
  expect(completionRepairFeedback(steps,'stop',reviewContext)).toContain(verdict);
});

test.each(['timingPass','pixelPass','textSafe','returnPass'])('an explicit failed %s cannot be hidden by a passing rendered observation',field=>{
  const steps=[renderedReview({checks:[{planId:'outline',timingPass:true,pixelPass:null,textSafe:true,returnPass:null,[field]:false}]})];
  expect(hasFailedRenderChecks(steps,reviewContext)).toBe(true);
  expect(completionRepairFeedback(steps,'stop',reviewContext)).toContain(field);
});

test.each([
  {checks:[]},
  {observations:[]},
  {checks:[{planId:'other',timingPass:true,textSafe:true}]},
  {observations:[{planId:'other',verdict:'pass'}]},
  {checks:[{planId:'outline',timingPass:true,textSafe:true},{planId:'outline',timingPass:true,textSafe:true}]},
  {observations:[{planId:'outline',verdict:'pass'},{planId:'outline',verdict:'pass'}]},
  {sampleTimes:[]},
  {sampleTimes:[Number.NaN]},
])('incomplete or mismatched rendered evidence cannot complete a planned expectation: %j',output=>{
  expect(hasFailedRenderChecks([renderedReview(output)],reviewContext)).toBe(true);
});

test.each([
  {textSafe:true},
  {minPixelChange:.1},
  {maxPixelChange:.5},
  {returnBy:1},
])('a specifically requested measured check needs a positive result: %j',checks=>{
  const context={plans:[{...reviewPlan,checks}],revision:2};
  const emptyCheck={planId:'outline',timingPass:true,pixelPass:null,textSafe:null,returnPass:null};
  expect(hasFailedRenderChecks([renderedReview({checks:[emptyCheck]})],context)).toBe(true);
  expect(hasFailedRenderChecks([renderedReview({checks:[{...emptyCheck,pixelPass:true,textSafe:true,returnPass:true}]})],context)).toBe(false);
});

test.each([
  {reviewed:false},
  {stale:true},
  {revision:1},
  {currentRevision:3},
])('a stale or unfinished review does not certify the final draft: %j',output=>{
  expect(hasFailedRenderChecks([renderedReview(output)],reviewContext)).toBe(true);
});

test('each planned effect needs its own current review, including plans restored from a continuation',()=>{
  const second={...reviewPlan,id:'shadow',effect:'shadow'};
  const context={plans:[reviewPlan,second],revision:2};
  expect(hasFailedRenderChecks([renderedReview()],context)).toBe(true);
  expect(hasFailedRenderChecks([renderedReview(),renderedReview({},['shadow'])],context)).toBe(false);
  expect(hasFailedRenderChecks([renderedReview({revision:1,currentRevision:1}),renderedReview({},['shadow'])],context)).toBe(true);
});

test('a corrected current review replaces a failure, but an invalid later review cannot retain an earlier pass',()=>{
  const failure=renderedReview({observations:[{planId:'outline',verdict:'unverifiable'}]});
  expect(hasFailedRenderChecks([failure,renderedReview()],reviewContext)).toBe(false);
  expect(completionRepairFeedback([failure,renderedReview()],'stop',reviewContext)).toBeUndefined();
  expect(hasFailedRenderChecks([renderedReview(),failure],reviewContext)).toBe(true);
  expect(hasFailedRenderChecks([renderedReview(),renderedReview({stale:true})],reviewContext)).toBe(true);
});

test('plan receipts, matched tool-call inputs and JSON tool outputs use the same completion gate',()=>{
  const planned={content:[{type:'tool-result',toolName:'planEffects',output:{planned:true,revision:2,plans:[reviewPlan]}}]};
  const completed=renderedReview().content[0];
  const steps=[planned,{content:[{type:'tool-call',toolName:'previewRender',toolCallId:'review',input:completed.input},{type:'tool-result',toolName:'previewRender',toolCallId:'review',output:{type:'json',value:completed.output}}]}];
  expect(hasFailedRenderChecks([planned])).toBe(true);
  expect(hasFailedRenderChecks(steps)).toBe(false);
  expect(hasFailedRenderChecks([...steps,{content:[{type:'tool-result',toolName:'inspectTimeline',output:{revision:3}}]}])).toBe(true);
});

test('changing an expectation invalidates its earlier receipt while attaching an output preserves it',()=>{
  const planned=(plan:EffectPlan)=>({content:[{type:'tool-result',toolName:'planEffects',output:{planned:true,revision:2,plans:[plan]}}]});
  expect(hasFailedRenderChecks([planned(reviewPlan),renderedReview(),planned({...reviewPlan,expectation:'The outline is twice as thick'})])).toBe(true);
  expect(hasFailedRenderChecks([planned(reviewPlan),renderedReview(),planned({...reviewPlan,outputClipId:'caption'})])).toBe(false);
});

test('later staged mutations invalidate an earlier review even without a saved revision change',()=>{
  const mutation={content:[{type:'tool-result',toolName:'setTextStyle',output:{staged:true,revision:2,changedClips:[{id:'caption'}]}}]};
  const unchanged={content:[{type:'tool-result',toolName:'setTextStyle',output:{staged:true,unchanged:true,revision:2,changedClips:[{id:'caption'}]}}]};
  expect(hasFailedRenderChecks([renderedReview(),mutation],reviewContext)).toBe(true);
  expect(completionRepairFeedback([renderedReview(),mutation],'stop',reviewContext)).toContain('staged timeline changed');
  expect(hasFailedRenderChecks([renderedReview(),mutation,renderedReview()],reviewContext)).toBe(false);
  expect(hasFailedRenderChecks([renderedReview(),unchanged],reviewContext)).toBe(false);
  const result={...renderedReview().content[0],toolCallId:'in-flight'};
  const inFlight={content:[{type:'tool-call',toolName:'previewRender',toolCallId:'in-flight',input:result.input}]};
  expect(hasFailedRenderChecks([inFlight,mutation,{content:[result]}],reviewContext)).toBe(true);
});

test('only backend-revalidated current-scope receipts survive unrelated changes and continuation',()=>{
  const mutation={content:[{type:'tool-result',toolName:'trim',output:{staged:true,revision:2,changedClips:[{id:'other'}]}}]};
  const completed=renderedReview().content[0].output;
  const context={...reviewContext,validReviews:[{planIds:['outline'],output:completed}]};
  expect(hasFailedRenderChecks([renderedReview(),mutation],reviewContext)).toBe(true);
  expect(hasFailedRenderChecks([renderedReview(),mutation],context)).toBe(false);
  expect(hasFailedRenderChecks([],context)).toBe(false);
  expect(completionRepairFeedback([],'stop',context)).toBeUndefined();
  expect(hasFailedRenderChecks([renderedReview()],{...context,validReviews:[{planIds:['outline'],output:{...completed,observations:[{planId:'outline',verdict:'unverifiable'}]}}]})).toBe(true);
  expect(hasFailedRenderChecks([],{...context,validReviews:[{planIds:['outline'],output:{...completed,checks:[]}}]})).toBe(true);
  expect(hasFailedRenderChecks([],{...context,validReviews:[{planIds:['outline'],output:{...completed,revision:1,currentRevision:1}}]})).toBe(true);
});
