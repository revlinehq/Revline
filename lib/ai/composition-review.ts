import { z } from 'zod';
import type { EffectPlan } from './edit-plan';
export const reviewObservations = z.object({
  observations:z.array(z.object({planId:z.string().max(80),verdict:z.enum(['pass','fail','unverifiable']),evidence:z.string().min(1).max(2000)})).min(1).max(2),
  uncertainty:z.string().max(2000),
});
export const reviewObservationsJsonSchema=z.toJSONSchema(reviewObservations);
export function parseCompositionReview(text:string,plans:EffectPlan[]) {
  const result=reviewObservations.parse(JSON.parse(text));
  if(result.observations.length!==plans.length||new Set(result.observations.map(o=>o.planId)).size!==plans.length||result.observations.some(o=>!plans.some(plan=>plan.id===o.planId)))throw new Error('Review must address exactly the planned expectations.');
  return result;
}
export function compositionSampleTimes(plans:EffectPlan[],fps:number,start:number,end:number) {
  const frame=1/fps;
  const times=plans.flatMap(plan=>[plan.start-frame,plan.start,plan.anchor.time,plan.peak??plan.start+plan.duration/2,plan.start+plan.duration-frame,plan.checks?.returnBy??plan.start+plan.duration+frame]);
  return [...new Set(times.map(time=>Math.round(Math.min(end-frame,Math.max(start,time))*fps)/fps))].sort((a,b)=>a-b).slice(0,12);
}
export function pixelDifference(actual:Uint8Array,reference:Uint8Array) {
  if(actual.length!==reference.length||!actual.length)throw new Error('Compare equal-sized rendered samples.');
  let sum=0;for(let i=0;i<actual.length;i++)sum+=Math.abs(actual[i]-reference[i]);
  return sum/(actual.length*255);
}
