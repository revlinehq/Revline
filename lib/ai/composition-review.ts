import { z } from 'zod';
import type { EffectPlan } from './edit-plan';
import { normalizeTimeline, trackOf, type Timeline } from '../editor/types';
import { equalTimelineValue } from '../editor/timeline-equality';
const reviewObservations = z.object({
  observations:z.array(z.object({planId:z.string().max(80),verdict:z.enum(['pass','fail','unverifiable']),evidence:z.string().min(1).max(2000)})).min(1).max(2),
  uncertainty:z.string().max(2000),
});
export const reviewObservationsJsonSchema=z.toJSONSchema(reviewObservations);
/** Negative judgments survive pixel changes. Refreshing a previously passed
 * scope still shares the run's strict infrastructure/provider attempt bound. */
export const MAX_COMPOSITION_REVIEW_ATTEMPTS = 18;
export function compositionReviewBudget(attempts:number,reviews:readonly {status:'queued'|'completed'|'failed';planIds:readonly string[];countedPlanIds?:readonly string[]}[],planIds:readonly string[]){
  if(attempts>=MAX_COMPOSITION_REVIEW_ATTEMPTS)throw new Error('Rendered review reached its retry limit. Saved edits remain.');
  if(reviews.some(review=>review.status==='queued'))throw new Error('Finish the current rendered review before requesting another.');
  if(planIds.some(id=>reviews.filter(review=>review.status==='completed'&&(review.countedPlanIds??review.planIds).includes(id)).length>=2))throw new Error('This expectation reached its visual review limit. Do not repeat a passed check or continue after two nonpassing judgments.');
  return reviews.filter(review=>review.status==='completed').length;
}
/** Review pixels depend on the visible window, including held transition
 * sources, rather than unrelated audio, markers or clips elsewhere. */
function compositionReviewScope(timeline:Timeline,start:number,end:number) {
  timeline=normalizeTimeline(timeline);
  const visible=timeline.clips.filter(clip=>clip.kind!=='audio'&&clip.start<end&&clip.start+clip.duration>start);
  const visibleIds=new Set(visible.map(clip=>clip.id));
  const dependencies=new Set(visible.flatMap(clip=>clip.transition?[clip.transition.fromClipId,clip.transition.toClipId]:[]));
  return {fps:timeline.fps,aspectRatio:timeline.aspectRatio,clips:timeline.clips.filter(clip=>clip.kind!=='audio'&&(visibleIds.has(clip.id)||dependencies.has(clip.id))).map(clip=>{
    const {audio,audioFadeTiming,volume,linkedClipId,audioSeparated,...visual}=clip;
    return {...visual,track:trackOf(clip)};
  })};
}
function expectationIdentity(plan:EffectPlan) {
  const {outputClipId,...goal}=plan,{time,description,...anchor}=plan.anchor;
  const normalize=(value:unknown):unknown=>typeof value==='number'&&Number.isFinite(value)?Math.round(value*1e7)/1e7:Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,normalize(item)])):value;
  return normalize({...goal,anchor});
}
const matchingGoals=(previous:readonly EffectPlan[],plans:readonly EffectPlan[])=>previous.filter(before=>{const current=plans.find(plan=>plan.id===before.id);return current&&equalTimelineValue(expectationIdentity(before),expectationIdentity(current));});
type ReviewSnapshot={timeline:Timeline;plans:readonly EffectPlan[];start:number;end:number};
/** Checkpoint publication changes the revision without changing the pixels.
 * Reuse only exact current goals and the exact rendered visible snapshot. */
export function currentReviewPlanIds(review:ReviewSnapshot,timeline:Timeline,plans:readonly EffectPlan[]) {
  if(!Number.isFinite(review.start)||!Number.isFinite(review.end)||review.start<0||review.end<=review.start||Math.max(0,...timeline.clips.map(clip=>clip.start+clip.duration))<review.end-1e-7||!equalTimelineValue(compositionReviewScope(review.timeline,review.start,review.end),compositionReviewScope(timeline,review.start,review.end)))return [];
  return matchingGoals(review.plans,plans).map(plan=>plan.id);
}
type ReviewJudgment={revision:number;sampleTimes:readonly number[];observations:readonly {planId:string;verdict:'pass'|'fail'|'unverifiable'}[];checks:readonly {planId:string;timingPass:boolean;pixelPass:boolean|null;textSafe:boolean|null;returnPass?:boolean|null}[]};
function passedJudgment(review:ReviewSnapshot&{revision:number;result?:ReviewJudgment},plan:EffectPlan) {
  const result=review.result;
  if(!result||result.revision!==review.revision||!result.sampleTimes.length||result.sampleTimes.some(time=>!Number.isFinite(time))||result.observations.length!==review.plans.length||result.checks.length!==review.plans.length)return false;
  const observations=result.observations.filter(item=>item.planId===plan.id),measurements=result.checks.filter(item=>item.planId===plan.id);
  if(observations.length!==1||observations[0].verdict!=='pass'||measurements.length!==1)return false;
  const check=measurements[0],required=plan.checks;
  return check.timingPass===true&&check.pixelPass!==false&&check.textSafe!==false&&check.returnPass!==false
    &&(required?.minPixelChange===undefined&&required?.maxPixelChange===undefined||check.pixelPass===true)
    &&(required?.textSafe!==true||check.textSafe===true)&&(required?.returnBy===undefined||check.returnPass===true);
}
/** Failed or unverifiable judgments cannot be reset by tweaking pixels. Only
 * an earlier pass that became stale is free to refresh after another fix. */
export function countedReviewPlanIds(review:ReviewSnapshot&{revision:number;result?:ReviewJudgment},timeline:Timeline,plans:readonly EffectPlan[]) {
  const current=new Set(currentReviewPlanIds(review,timeline,plans));
  return matchingGoals(review.plans,plans).filter(plan=>current.has(plan.id)||!passedJudgment(review,plan)).map(plan=>plan.id);
}
export function parseCompositionReview(text:string,plans:EffectPlan[]) {
  const result=reviewObservations.parse(JSON.parse(text));
  if(result.observations.length!==plans.length||new Set(result.observations.map(o=>o.planId)).size!==plans.length||result.observations.some(o=>!plans.some(plan=>plan.id===o.planId)))throw new Error('Review must address exactly the planned expectations.');
  return result;
}
/** Select complete frame boundaries around every promised event, including an
 * anchor before the edit starts. Padding yields to the three-second bound. */
export function compositionReviewWindow(plans:EffectPlan[],fps:number,timelineEnd:number) {
  if(!plans.length||![24,30,60].includes(fps)||!Number.isFinite(timelineEnd)||timelineEnd<=0)throw new Error('Rendered review needs expectations and a valid timeline.');
  const required=plans.flatMap(plan=>[plan.start,plan.anchor.time,...(plan.peak===undefined?[]:[plan.peak]),...(plan.checks?.returnBy===undefined?[]:[plan.checks.returnBy])]);
  if(required.some(time=>!Number.isFinite(time)||time<0))throw new Error('Rendered review expectations need finite nonnegative times.');
  const frames=required.map(time=>Math.round(time*fps)),first=Math.min(...frames),last=Math.max(...frames),limit=3*fps;
  const timelineLast=Math.ceil(timelineEnd*fps-1e-7)-1;
  if(last>timelineLast||last-first>=limit)throw new Error('A planned start, anchor, peak or return is outside the rendered review window. Choose expectations within the same three-second window.');
  const startFrame=Math.max(0,Math.min(first-1,timelineLast),last-limit+1);
  const desiredEnd=Math.ceil(Math.max(...plans.map(plan=>Math.max(plan.start+plan.duration,plan.checks?.returnBy??0)))*fps)+2;
  const end=Math.min(timelineEnd,Math.min(startFrame+limit,Math.max(last+2,desiredEnd))/fps);
  return {start:startFrame/fps,end};
}
export function compositionSampleTimes(plans:EffectPlan[],fps:number,start:number,end:number) {
  const first=Math.ceil(start*fps-1e-7),last=Math.ceil(end*fps-1e-7)-1;
  if(![24,30,60].includes(fps)||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end-start>3.00001||last<first)throw new Error('Choose a rendered review window containing at least one frame within three seconds.');
  const frame=1/fps;
  const times=plans.flatMap(plan=>[plan.start-frame,plan.start,plan.anchor.time,plan.peak??plan.start+plan.duration/2,plan.start+plan.duration-frame,plan.checks?.returnBy??plan.start+plan.duration+frame]);
  return [...new Set(times.map(time=>Math.min(last,Math.max(first,Math.round(time*fps)))/fps))].sort((a,b)=>a-b).slice(0,12);
}
export function pixelDifference(actual:Uint8Array,reference:Uint8Array) {
  if(actual.length!==reference.length||!actual.length)throw new Error('Compare equal-sized rendered samples.');
  let sum=0;for(let i=0;i<actual.length;i++)sum+=Math.abs(actual[i]-reference[i]);
  return sum/(actual.length*255);
}
/** Share of pixels (raw RGB) where any channel moved by more than `threshold`: a small changed area still counts, unlike the mean. */
export function changedShare(actual:Uint8Array,reference:Uint8Array,threshold=24) {
  if(actual.length!==reference.length||!actual.length||actual.length%3)throw new Error('Compare equal-sized RGB samples.');
  let changed=0;for(let i=0;i<actual.length;i+=3)if(Math.abs(actual[i]-reference[i])>threshold||Math.abs(actual[i+1]-reference[i+1])>threshold||Math.abs(actual[i+2]-reference[i+2])>threshold)changed++;
  return changed/(actual.length/3);
}
