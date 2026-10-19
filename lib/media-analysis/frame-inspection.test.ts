import { afterEach, expect, test, vi } from 'vitest';
import { assertConsecutiveInspection, frameInspectionCoverage, frameEvidenceOnClip, parseFrameInspection, selectInspectionFrames, validateFrameInspectionInput, validateFrameInspectionResult } from './frame-inspection';
import { inspectVideoFrames } from './gemini';
import { hasUnresolvedToolFailures } from '../ai/tool-failures';

const input = { start: 1, end: 1.1, question: 'When does the fist contact its target?' };
const samples = [{ frameIndex: 30, time: 1 }, { frameIndex: 31, time: 31 / 30 }, { frameIndex: 32, time: 32 / 30 }];
const answer = { summary: 'Apparent contact in the second frame.', uncertainty: 'Contact is visible, but a sound cannot be inferred.', frames: samples.map(frame => ({ frameIndex: frame.frameIndex, observation: 'Fist near the target.' })), events: [{ frameIndex: 31, description: 'Apparent contact', confidence: 'medium' as const }] };
afterEach(() => vi.unstubAllGlobals());

test('rejects out-of-range or unbounded frame requests', () => {
  expect(() => validateFrameInspectionInput(input, 2)).not.toThrow();
  for (const range of [{ start: -1, end: 1 }, { start: 0, end: 4 }, { start: 1, end: 1 }, { start: 0, end: Infinity }, { start: 1, end: 3 }]) expect(() => validateFrameInspectionInput({ ...input, ...range }, 2)).toThrow('window');
  expect(() => validateFrameInspectionInput({ ...input, question: ' ' }, 2)).toThrow('question');
});

test('narrow windows keep consecutive frames; broad windows sample actual indices and PTS', () => {
  const source = Array.from({ length: 90 }, (_, frameIndex) => ({ frameIndex, time: frameIndex / 30 }));
  expect(selectInspectionFrames(source, input)).toEqual(samples);
  const sparse = selectInspectionFrames(source, { ...input, start: 0, end: 3 });
  expect(sparse).toHaveLength(12);
  expect(sparse[0]).toEqual(source[0]); expect(sparse[11]).toEqual(source[89]);
  expect(sparse.every(frame => source.includes(frame))).toBe(true);
  expect(() => selectInspectionFrames(source, { ...input, start: 3, end: 3.1 })).toThrow('No decoded');
});

const inspected=(frames:{frameIndex:number;time:number}[],request={...input,start:0,end:3},fps=60,events:{frameIndex:number;description:string;confidence:'low'|'medium'|'high'}[]=[])=>parseFrameInspection(JSON.stringify({...answer,frames:frames.map(frame=>({frameIndex:frame.frameIndex,observation:'Observed source frame.'})),events}),request,frames,fps);

test('60fps sparse coverage can miss a 100ms event and recommends bounded consecutive refinement',()=>{
  const source=Array.from({length:180},(_,frameIndex)=>({frameIndex,time:frameIndex/60})),request={...input,start:0,end:3};
  const sparse=inspected(selectInspectionFrames(source,request),request);
  expect(sparse.frames.some(frame=>frame.time>=1.45&&frame.time<1.55)).toBe(false);
  const coverage=frameInspectionCoverage(sparse);
  expect(coverage.consecutive).toBe(false);expect(coverage.maxGapSeconds).toBeCloseTo(17/60);
  expect(coverage.start).toBe(0);expect(coverage.end).toBe(179/60);
  expect(coverage.refinementWindows).toHaveLength(1);
  const narrow=coverage.refinementWindows[0];
  expect(narrow.reason).toBe('largest-unsampled-gap');expect(narrow.end-narrow.start).toBeLessThanOrEqual(11/60+1e-9);
  const refined=inspected(selectInspectionFrames(source,{...request,...narrow}),{...request,...narrow});
  expect(refined.frames.some(frame=>frame.time>=1.45&&frame.time<1.55)).toBe(true);
  expect(()=>assertConsecutiveInspection(sparse)).toThrow('narrower source window');
  expect(()=>assertConsecutiveInspection(refined)).not.toThrow();
});

test('refinement prioritizes observed event frames and clamps at requested source edges',()=>{
  const source=Array.from({length:180},(_,frameIndex)=>({frameIndex,time:10+frameIndex/60})),request={...input,start:10,end:13};
  const frames=selectInspectionFrames(source,request),events=frames.slice().reverse().map(frame=>({frameIndex:frame.frameIndex,description:'Observed movement',confidence:'high' as const}));
  const coverage=frameInspectionCoverage(inspected(frames,request,60,events));
  expect(coverage.refinementWindows).toHaveLength(3);
  for(const window of coverage.refinementWindows){
    expect(window.reason).toBe('observed-event');expect(window.start).toBeGreaterThanOrEqual(10);expect(window.end).toBeLessThanOrEqual(13);
    expect(window.end-window.start).toBeLessThanOrEqual(11/60+1e-9);
    expect(frames.some(frame=>frame.frameIndex===window.anchorFrameIndex&&frame.time===window.anchorTime)).toBe(true);
    expect(window.anchorTime).toBeGreaterThanOrEqual(window.start);expect(window.anchorTime).toBeLessThan(window.end);
  }
});

test('consecutive verification uses decoded VFR indices while reporting real timestamp gaps and missing edges',()=>{
  const request={...input,start:0,end:.12},frames=[{frameIndex:0,time:0},{frameIndex:1,time:.01},{frameIndex:2,time:.025},{frameIndex:3,time:.07},{frameIndex:4,time:.1}],evidence=inspected(frames,request,40);
  expect(frameInspectionCoverage(evidence)).toMatchObject({consecutive:true,leadingGapSeconds:0});
  expect(frameInspectionCoverage(evidence).maxGapSeconds).toBeCloseTo(.045);
  expect(()=>assertConsecutiveInspection(evidence)).not.toThrow();
  const missingEdges=inspected([{frameIndex:2,time:.05},{frameIndex:3,time:.075}],{...input,start:0,end:.2},40);
  expect(()=>assertConsecutiveInspection(missingEdges)).toThrow('window edges');
  expect(frameInspectionCoverage(missingEdges).refinementWindows[0]).toMatchObject({reason:'uncovered-window-edge'});
  expect(()=>assertConsecutiveInspection(inspected([{frameIndex:3,time:.05}],{...input,start:.045,end:.055},60))).not.toThrow();
});

test('source timestamps are attached by code and invented frame evidence is rejected', () => {
  const result = parseFrameInspection(JSON.stringify(answer), input, samples, 30);
  expect(result.events[0]).toMatchObject({ frameIndex: 31, time: 31 / 30 });
  expect(result.consecutive).toBe(true); expect(result.sampleInterval).toBeCloseTo(1 / 30);
  expect(() => parseFrameInspection(JSON.stringify({ ...answer, events: [{ ...answer.events[0], frameIndex: 999 }] }), input, samples, 30)).toThrow('exact frames');
  expect(() => parseFrameInspection(JSON.stringify({ ...answer, frames: [answer.frames[0], answer.frames[0], answer.frames[2]] }), input, samples, 30)).toThrow('exact frames');
  expect(() => validateFrameInspectionResult({ ...result, consecutive: false }, input)).toThrow('sampling metadata');
  expect(() => validateFrameInspectionResult({ ...result, events: [{ ...result.events[0], time: 1.01 }] }, input)).toThrow('inspected frames');
});

test('Gemini receives labeled inline frames and returns evidence without fabricated timing', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: JSON.stringify(answer) }), { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  const result = await inspectVideoFrames(samples.map(frame => ({ ...frame, data: 'ZmFrZS1pbWFnZQ==' })), 30, input, 'fixture-key', AbortSignal.timeout(1000));
  expect(result.events[0].time).toBe(31 / 30);
  expect(result.frames[0]).not.toHaveProperty('data');
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.store).toBe(false);
  expect(body.input.filter((item: { type: string }) => item.type === 'image')).toHaveLength(3);
  expect(body.input.some((item: { text?: string }) => item.text?.includes('SOURCE FRAME 31; source timestamp 1.033333'))).toBe(true);
  expect(body.response_format.mime_type).toBe('application/json');
  expect(body.input[0].text).toContain('consecutive recorded frames');
  expect(body.input[0].text).toContain('not shown in these samples');
});

test('sparse sampling is disclosed to Gemini without automatically issuing more paid requests',async()=>{
  const request={...input,start:0,end:3},frames=selectInspectionFrames(Array.from({length:180},(_,frameIndex)=>({frameIndex,time:frameIndex/60})),request);
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({output_text:JSON.stringify({...answer,frames:frames.map(frame=>({frameIndex:frame.frameIndex,observation:'No reset shown at this sampled instant.'})),events:[]})}),{status:200}));
  vi.stubGlobal('fetch',fetcher);
  const result=await inspectVideoFrames(frames.map(frame=>({...frame,data:'ZmFrZS1pbWFnZQ=='})),60,request,'fixture-key',AbortSignal.timeout(1000));
  expect(result.consecutive).toBe(false);expect(fetcher).toHaveBeenCalledTimes(1);
  const body=JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.input[0].text).toContain('nonconsecutive samples');expect(body.input[0].text).toContain('0.283333 seconds');
  expect(body.input[0].text).toContain('brief event can fit entirely between samples');
});

test('frame evidence maps through retained source trims and speed without filling unseen intervals', () => {
  const result = parseFrameInspection(JSON.stringify(answer), input, samples, 30);
  const mapped = frameEvidenceOnClip(result, { id: 'retained', kind: 'video', start: 8, sourceStart: 31 / 30, duration: 1 / 60, playbackRate: 2 });
  expect(mapped.frames).toEqual([{ ...result.frames[1], timelineTime: 8 }]);
  expect(mapped.events).toEqual([{ ...result.events[0], timelineTime: 8 }]);
  expect(mapped.events[0]).not.toHaveProperty('end');
});

const geometry={sourceWidth:1920,sourceHeight:1080,decodedWidth:960,decodedHeight:540};
const target={frameIndex:31,label:'Upload modal',confidence:'high' as const,box:{left:.65,top:.2,right:.85,bottom:.4}};
test('localized boxes use only decoded frame indices, dimensions and code-owned source timestamps',()=>{
  const result=parseFrameInspection(JSON.stringify({...answer,targets:[target]}),input,samples,30,geometry);
  expect(result.targets?.[0]).toEqual({...target,time:31/30});expect(result.geometry).toEqual(geometry);
  expect(()=>parseFrameInspection(JSON.stringify({...answer,targets:[{...target,frameIndex:999}]}),input,samples,30,geometry)).toThrow('exact frames');
  expect(()=>parseFrameInspection(JSON.stringify({...answer,targets:[target]}),input,samples,30)).toThrow('dimensions');
  for(const box of [{...target.box,left:-.1},{...target.box,right:1.1},{...target.box,right:.6},{...target.box,bottom:.1}])expect(()=>parseFrameInspection(JSON.stringify({...answer,targets:[{...target,box}]}),input,samples,30,geometry)).toThrow();
  expect(()=>validateFrameInspectionResult({...result,targets:[{...result.targets![0],time:1.02}]},input)).toThrow('inspected frames');
});
test('localization reaches Gemini as labeled uncropped images and explicit normalized target schema',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({output_text:JSON.stringify({...answer,targets:[target]})}),{status:200}));vi.stubGlobal('fetch',fetcher);
  const result=await inspectVideoFrames(samples.map(frame=>({...frame,data:'ZmFrZS1pbWFnZQ=='})),30,{...input,question:'Locate the Upload modal for a zoom.'},'fixture-key',AbortSignal.timeout(1000),geometry);
  expect(result.targets?.[0]).toMatchObject({label:'Upload modal',time:31/30,box:target.box});
  const body=JSON.parse(fetcher.mock.calls[0][1].body);expect(body.input[0].text).toContain('960×540');expect(body.input[0].text).toContain('normalized original-image');expect(body.response_format.schema.properties.targets.items.properties.box.properties.left.maximum).toBe(1);
});


test('a server-suggested consecutive refinement resolves only its matching no-write sampling rejection',()=>{
  const broad={assetId:'source',question:'Check the brief glance',start:0,end:3,precision:'consecutive'};
  const window={start:1.4,end:1.58};
  const failed={content:[{type:'tool-call',toolName:'inspectFrames',toolCallId:'wide',input:broad},{type:'tool-result',toolName:'inspectFrames',toolCallId:'wide',output:{success:false,code:'FRAME_REFINEMENT_REQUIRED',coverage:{refinementWindows:[window]},error:'Consecutive frame verification did not pass'}}]};
  const refined={...broad,...window};
  const result=(input:unknown,consecutive=true)=>({content:[{type:'tool-call',toolName:'inspectFrames',toolCallId:'narrow',input},{type:'tool-result',toolName:'inspectFrames',toolCallId:'narrow',output:{precision:'consecutive',consecutive,coverage:{consecutive}}}]});
  expect(hasUnresolvedToolFailures([failed])).toBe(true);
  expect(hasUnresolvedToolFailures([failed,result(refined)])).toBe(false);
  for(const input of [{...refined,assetId:'other'},{...refined,question:'Different task'},{...refined,start:0,end:.18},{...refined,precision:'sampled'}])expect(hasUnresolvedToolFailures([failed,result(input)])).toBe(true);
  expect(hasUnresolvedToolFailures([failed,result(refined,false)])).toBe(true);
});
