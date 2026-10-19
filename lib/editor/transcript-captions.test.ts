import {hasUnresolvedToolFailures,hasOnlyUnresolvedInspectionFailures} from '../ai/tool-failures';
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
