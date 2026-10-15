import { expect, test } from 'vitest';
import { HORMOZI_DEMO_ASSET, hormoziDemoPlan } from './hormozi-demo';
import { generateComposition } from './composition';
import { timelineDuration } from './types';

test('the prepared take keeps the actual speech, continuous footage, and linked sound at original timing',()=>{
  const plan=hormoziDemoPlan('take');
  let clips=plan.initial.clips;
  for(const step of plan.steps){clips=[...clips,...step.clips];expect(()=>generateComposition({...plan.initial,clips},plan.assets)).not.toThrow();}
  expect(clips).toEqual(plan.timeline.clips);
  expect(timelineDuration(plan.timeline)).toBe(45);
  expect(clips.filter(c=>c.kind==='video')).toEqual([expect.objectContaining({assetId:HORMOZI_DEMO_ASSET._id,start:0,sourceStart:0,duration:45,volume:0,audioSeparated:true})]);
  expect(clips.filter(c=>c.kind==='audio')).toEqual([expect.objectContaining({start:0,sourceStart:0,duration:45,volume:1})]);
  const captions=clips.filter(c=>c.kind==='caption');
  expect(captions).toHaveLength(39);
  expect(captions.map(c=>c.text).join(' ')).toContain('businesses die of indigestion, not starvation.');
  for(let i=0;i<captions.length;i++){
    expect(captions[i].start+captions[i].duration).toBeLessThanOrEqual(45);
    if(i)expect(captions[i].start).toBeGreaterThanOrEqual(captions[i-1].start+captions[i-1].duration-1e-6);
  }
});

test('only two subject-centered zooms peak on the selected spoken events and return to neutral',()=>{
  const plan=hormoziDemoPlan('take'),zooms=plan.timeline.clips.filter(c=>c.kind==='effect');
  expect(zooms).toHaveLength(2);
  for(const [i,clip] of zooms.entries()){
    expect(clip.motion?.[0].scale).toBe(1);expect(clip.motion?.at(-1)?.scale).toBe(1);
    const peak=clip.motion!.reduce((a,b)=>a.scale>b.scale?a:b);
    expect(clip.start+peak.time).toBeCloseTo([26.74,42.94][i]);
    expect(peak.scale).toBeCloseTo([1.035,1.025][i]);
    expect(peak.x).toBeCloseTo((.5-[.82,.48][i])*(peak.scale-1));
  }
  const other=hormoziDemoPlan('another-take');
  expect(plan.timeline.clips.some(c=>other.timeline.clips.some(o=>o.id===c.id))).toBe(false);
});
