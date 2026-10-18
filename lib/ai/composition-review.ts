import { z } from 'zod';
import type { EffectPlan } from './edit-plan';
export const reviewObservations = z.object({
  observations:z.array(z.object({planId:z.string().max(80),verdict:z.enum(['pass','fail','unverifiable']),evidence:z.string().min(1).max(2000)})).min(1).max(2),
  uncertainty:z.string().max(2000),
});
export const reviewObservationsJsonSchema=z.toJSONSchema(reviewObservations);
/** Failed infrastructure attempts do not consume the two visual judgments.
 * Bound all attempts as well so an unavailable renderer cannot create a loop. */
export function compositionReviewBudget(attempts:number,statuses:readonly ('queued'|'completed'|'failed')[]){
  if(attempts>=4)throw new Error('Rendered review reached its retry limit after infrastructure failures. Saved edits remain.');
  if(statuses.includes('queued'))throw new Error('Finish the current rendered review before requesting another.');
  const completed=statuses.filter(status=>status==='completed').length;
  if(completed>=2)throw new Error('Review allows one initial check and one fix pass per run.');
  return completed;
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
