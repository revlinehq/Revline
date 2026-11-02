import { z } from 'zod';
import type { Clip } from '../editor/types';
import { sourceEndOf, timelineTimeAtSource } from '../editor/playback-rate';
const MAX_FRAME_WINDOW = 3;
const MAX_INSPECTION_FRAMES = 12;
export type FrameInspectionInput = { start: number; end: number; question: string };
export type FrameGeometry = { sourceWidth:number; sourceHeight:number; decodedWidth:number; decodedHeight:number };
export type FrameTarget = {frameIndex:number;time:number;label:string;confidence:'low'|'medium'|'high';box:{left:number;top:number;right:number;bottom:number}};
export type FrameSample = { frameIndex: number; time: number };
export type FrameInspection = FrameInspectionInput & {
  sourceFps: number; sampleInterval: number; consecutive: boolean;
  summary: string; uncertainty: string;
  geometry?:FrameGeometry; targets?:FrameTarget[];
  frames: (FrameSample & { observation: string })[];
  events: (FrameSample & { description: string; confidence: 'low' | 'medium' | 'high' })[];
};

type CoverageSource = Pick<FrameInspectionInput,'start'|'end'> & {sourceFps:number;frames:readonly FrameSample[];events?:readonly (FrameSample&{confidence?:'low'|'medium'|'high'})[]};
type RefinementWindow = {start:number;end:number;reason:'observed-event'|'largest-unsampled-gap'|'uncovered-window-edge';anchorFrameIndex?:number;anchorTime?:number};

/** Derived metadata, including for saved evidence from older workers. Sampled
 * endpoints describe observed instants, never continuous full-window coverage. */
export function frameInspectionCoverage(source:CoverageSource) {
  const {frames,sourceFps}=source;
  if(!frames.length||!Number.isFinite(sourceFps)||sourceFps<=0||!Number.isFinite(source.start)||!Number.isFinite(source.end)||source.end<=source.start)throw new Error('Frame coverage needs decoded frames and a valid source window.');
  const first=frames[0],last=frames[frames.length-1],frameSeconds=1/sourceFps;
  const consecutive=frames.every((frame,index)=>index===0||frame.frameIndex===frames[index-1].frameIndex+1);
  const gaps=frames.slice(1).map((frame,index)=>({before:frames[index],after:frame,seconds:frame.time-frames[index].time}));
  const leadingGapSeconds=Math.max(0,first.time-source.start),trailingGapSeconds=Math.max(0,source.end-last.time);
  const maxConsecutiveWindowSeconds=Math.min(MAX_FRAME_WINDOW,(MAX_INSPECTION_FRAMES-1)/sourceFps);
  const width=Math.min(source.end-source.start,maxConsecutiveWindowSeconds),refinementWindows:RefinementWindow[]=[];
  const suggest=(time:number,reason:RefinementWindow['reason'],anchor?:FrameSample)=>{
    if(refinementWindows.length>=3||refinementWindows.some(window=>time>=window.start&&time<window.end))return;
    const start=Math.max(source.start,Math.min(time-width/2,source.end-width)),end=Math.min(source.end,start+width);
    refinementWindows.push({start,end,reason,...(anchor?{anchorFrameIndex:anchor.frameIndex,anchorTime:anchor.time}:{})});
  };
  const confidence={high:3,medium:2,low:1};
  const events=[...(source.events??[])].filter(event=>frames.some(frame=>frame.frameIndex===event.frameIndex&&frame.time===event.time)).sort((a,b)=>(confidence[b.confidence??'low']-confidence[a.confidence??'low'])||a.time-b.time);
  for(const event of events)suggest(event.time,'observed-event',event);
  if(!refinementWindows.length){
    const midpoint=(source.start+source.end)/2;
    // FFprobe emits rounded microsecond PTS. Equivalent gaps should still use
    // the midpoint tie-break rather than move the suggestion across the source.
    const skipped=gaps.filter(gap=>gap.after.frameIndex>gap.before.frameIndex+1).sort((a,b)=>Math.abs(b.seconds-a.seconds)>2e-6?b.seconds-a.seconds:Math.abs((a.before.time+a.after.time)/2-midpoint)-Math.abs((b.before.time+b.after.time)/2-midpoint))[0];
    if(skipped)suggest((skipped.before.time+skipped.after.time)/2,'largest-unsampled-gap');
    else if(Math.max(leadingGapSeconds,trailingGapSeconds)>frameSeconds+1e-6){
      const anchor=leadingGapSeconds>=trailingGapSeconds?first:last;
      suggest(anchor.time,'uncovered-window-edge',anchor);
    }
  }
  return {scope:'sampled-source-frames' as const,start:first.time,end:last.time,sampledFrameCount:frames.length,consecutive,maxGapSeconds:Math.max(0,...gaps.map(gap=>gap.seconds)),leadingGapSeconds,trailingGapSeconds,maxConsecutiveWindowSeconds,refinementWindows,note:'Sampled instants only. Suggested source windows are not proof that the whole requested window was inspected.'};
}

/** A dense verification receipt must not quietly pass on sparse cached images.
 * Average FPS only bounds edge tolerance; VFR indices remain authoritative. */
export function assertConsecutiveInspection(result:FrameInspection) {
  const coverage=frameInspectionCoverage(result),tolerance=1/result.sourceFps+1e-6;
  if(!result.consecutive||!coverage.consecutive||coverage.leadingGapSeconds>tolerance||coverage.trailingGapSeconds>tolerance){
    const suggested=coverage.refinementWindows[0];
    throw new Error(`Consecutive frame verification did not pass: ${!result.consecutive||!coverage.consecutive?'recorded source frames were skipped':'requested window edges were not covered by nearby sampled frames'}. Inspect a narrower source window${suggested?` such as ${JSON.stringify({start:suggested.start,end:suggested.end})}`:''}; sparse samples cannot verify an unsampled boundary.`);
  }
  return coverage;
}

/** Map only decoded evidence still present in this clip, without inventing an
 * event duration between sampled frames or treating source time as edit time. */
export function frameEvidenceOnClip(result: FrameInspection, clip: Clip) {
  const retained = (sample: FrameSample) => sample.time >= clip.sourceStart - 1e-9 && sample.time < sourceEndOf(clip) - 1e-9;
  return {
    frames: result.frames.filter(retained).map(frame => ({ ...frame, timelineTime: timelineTimeAtSource(clip, frame.time) })),
    events: result.events.filter(retained).map(event => ({ ...event, timelineTime: timelineTimeAtSource(clip, event.time) })),
    ...(result.targets?{targets:result.targets.filter(retained).map(target=>({...target,timelineTime:timelineTimeAtSource(clip,target.time)}))}:{}),
  };
}

export function validateFrameInspectionInput(input: FrameInspectionInput, duration: number) {
  if (![input.start, input.end, duration].every(Number.isFinite) || input.start < 0 || input.end <= input.start || input.end > duration + 1e-6 || input.end - input.start > MAX_FRAME_WINDOW + 1e-6) throw new Error('Inspect a source window of up to three seconds within this video.');
  if (!input.question.trim() || input.question.length > 1000) throw new Error('Ask a focused visual question of 1–1000 characters.');
}

export function selectInspectionFrames(frames: FrameSample[], input: FrameInspectionInput) {
  const inside = frames.filter(frame => frame.time >= input.start - 1e-6 && frame.time < input.end - 1e-6);
  if (!inside.length) throw new Error('No decoded video frame falls in that window. Widen it by a frame.');
  if (inside.length <= MAX_INSPECTION_FRAMES) return inside;
  return Array.from({ length: MAX_INSPECTION_FRAMES }, (_, index) => inside[Math.round(index * (inside.length - 1) / (MAX_INSPECTION_FRAMES - 1))]);
}

const observation = z.object({ frameIndex: z.number().int().nonnegative(), observation: z.string().min(1).max(800) });
const event = z.object({ frameIndex: z.number().int().nonnegative(), description: z.string().min(1).max(500), confidence: z.enum(['low', 'medium', 'high']) });
const target=z.object({frameIndex:z.number().int().nonnegative(),label:z.string().trim().min(1).max(160),confidence:z.enum(['low','medium','high']),box:z.object({left:z.number().min(0).max(1),top:z.number().min(0).max(1),right:z.number().min(0).max(1),bottom:z.number().min(0).max(1)})});
const response = z.object({ summary: z.string().max(2000), uncertainty: z.string().max(2000), frames: z.array(observation).min(1).max(MAX_INSPECTION_FRAMES), events: z.array(event).max(MAX_INSPECTION_FRAMES),targets:z.array(target).max(MAX_INSPECTION_FRAMES).optional() });
// New workers must return the localization field explicitly, even when no
// requested target is visible. Keep parsing older saved observations readable.
export const frameInspectionJsonSchema = z.toJSONSchema(response.extend({ targets: z.array(target).max(MAX_INSPECTION_FRAMES) }));

export function parseFrameInspection(text: string, input: FrameInspectionInput, samples: FrameSample[], sourceFps: number,geometry?:FrameGeometry): FrameInspection {
  const parsed = response.parse(JSON.parse(text));
  const byIndex = new Map(samples.map(frame => [frame.frameIndex, frame]));
  if (new Set(parsed.frames.map(frame => frame.frameIndex)).size !== samples.length || parsed.frames.length !== samples.length || parsed.frames.some(frame => !byIndex.has(frame.frameIndex)) || parsed.events.some(item => !byIndex.has(item.frameIndex))||(parsed.targets??[]).some(item=>!byIndex.has(item.frameIndex))) throw new Error('Frame evidence must refer to the exact frames that were inspected.');
  const observed = new Map(parsed.frames.map(frame => [frame.frameIndex, frame.observation]));
  const result:FrameInspection = { ...input, sourceFps,...(geometry?{geometry}:{}),...(parsed.targets?{targets:parsed.targets.map(item=>({...item,time:byIndex.get(item.frameIndex)!.time}))}:{}), sampleInterval: Math.max(1 / sourceFps, ...samples.slice(1).map((frame, index) => frame.time - samples[index].time)), consecutive: samples.every((frame, index) => index === 0 || frame.frameIndex === samples[index - 1].frameIndex + 1), summary: parsed.summary, uncertainty: parsed.uncertainty, frames: samples.map(({ frameIndex, time }) => ({ frameIndex, time, observation: observed.get(frameIndex)! })), events: parsed.events.map(item => ({ ...item, time: byIndex.get(item.frameIndex)!.time })) };
  validateFrameInspectionResult(result, input);
  return result;
}

export function validateFrameInspectionResult(result: FrameInspection, input: FrameInspectionInput) {
  validateFrameInspectionInput(input, input.end);
  if (result.start !== input.start || result.end !== input.end || result.question !== input.question || !Number.isFinite(result.sourceFps) || result.sourceFps <= 0 || result.sourceFps > 1000 || !Number.isFinite(result.sampleInterval) || result.sampleInterval <= 0 || result.summary.length > 2000 || result.uncertainty.length > 2000 || !result.frames.length || result.frames.length > MAX_INSPECTION_FRAMES || result.events.length > MAX_INSPECTION_FRAMES) throw new Error('Invalid frame inspection result.');
  for (const [index, frame] of result.frames.entries()) {
    if (!Number.isInteger(frame.frameIndex) || frame.frameIndex < 0 || !Number.isFinite(frame.time) || frame.time < input.start - 1e-6 || frame.time >= input.end || !frame.observation.trim() || frame.observation.length > 800 || (index > 0 && (frame.time <= result.frames[index - 1].time || frame.frameIndex <= result.frames[index - 1].frameIndex))) throw new Error('Invalid frame evidence timestamp.');
  }
  const consecutive = result.frames.every((frame, index) => index === 0 || frame.frameIndex === result.frames[index - 1].frameIndex + 1);
  const interval = Math.max(1 / result.sourceFps, ...result.frames.slice(1).map((frame, index) => frame.time - result.frames[index].time));
  if (result.consecutive !== consecutive || Math.abs(result.sampleInterval - interval) > 1e-6) throw new Error('Frame sampling metadata does not match the evidence.');
  if(result.geometry&&Object.values(result.geometry).some(value=>!Number.isInteger(value)||value<=0||value>32768))throw new Error('Invalid decoded frame dimensions.');
  if(result.targets?.length){
    if(!result.geometry||result.targets.length>MAX_INSPECTION_FRAMES)throw new Error('Localized targets need decoded frame dimensions.');
    for(const target of result.targets){
      const box=target.box;
      if(!result.frames.some(frame=>frame.frameIndex===target.frameIndex&&frame.time===target.time)||!target.label.trim()||target.label.length>160||!['low','medium','high'].includes(target.confidence)||Object.values(box).some(value=>!Number.isFinite(value)||value<0||value>1)||box.right<=box.left||box.bottom<=box.top)throw new Error('Localized targets must use valid boxes on inspected frames.');
    }
  }
  for (const event of result.events) if (!result.frames.some(frame => frame.frameIndex === event.frameIndex && frame.time === event.time) || !event.description.trim() || event.description.length > 500 || !['low', 'medium', 'high'].includes(event.confidence)) throw new Error('Events must refer to inspected frames.');
}
