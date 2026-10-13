import { describe, expect, it } from 'vitest';
import { motionPreset, motionAt, visibleMotion, validateClipEffects, MOTION_PRESETS } from './clip-effects';
import { splitClip } from './operations';
import { resizeSelectedClips } from './timeline-controls';
import { generateComposition } from './composition';
import type { Clip, Timeline } from './types';
const clip: Clip = { id:'word', kind:'graphic', text:'IMPACT', start:2, duration:2, sourceStart:0 };
const timeline: Timeline = { fps:30, aspectRatio:'vertical', tracks:{visual:1,overlay:0,audio:0}, clips:[clip] };
describe('clip motion',()=>{
  it('all presets have bounded increasing keyframes, including one-frame clips',()=>{
    for (const duration of [1/60,1/30,2,60]) for (const preset of MOTION_PRESETS) expect(()=>validateClipEffects({...clip,duration,...motionPreset({...clip,duration},preset)})).not.toThrow();
  });
  it('splits and left trims retain the original animation phase',()=>{
    const animated={...clip,...motionPreset(clip,'fade')};
    const source={...timeline,clips:[animated]};
    const split=splitClip(source,clip.id,3,'tail');
    expect(visibleMotion(split.clips[1])[0].opacity).toBe(1);
    expect(visibleMotion(split.clips[1]).at(-1)?.opacity).toBe(0);
    const trimmed=resizeSelectedClips(source,[],[clip.id],'left',.2);
    expect(visibleMotion(trimmed.clips[0])[0].opacity).toBeCloseTo(motionAt(animated.motion!, .2).opacity);
  });
  it('rejects non-finite, excessive, out-of-order and audio effects',()=>{
    const motion=motionPreset(clip,'punch').motion!;
    for(const invalid of [{...clip,motion:[{...motion[0],scale:Infinity}]},{...clip,motion:[motion[1],motion[0]]},{...clip,motion:Array(121).fill(motion[0])},{...clip,kind:'audio' as const,motion}])expect(()=>validateClipEffects(invalid)).toThrow();
  });
  it('generates deterministic child motion and compositing without arbitrary script',()=>{
    const html=generateComposition({...timeline,clips:[{...clip,...motionPreset(clip,'pop'),blendMode:'screen'}]},[]);
    expect(html).toContain('mix-blend-mode:screen');expect(html).toContain("timeline.fromTo('#clip-0-motion'");
    expect(html).toContain('immediateRender');expect(html).toContain('class="text-motion"');
    expect(()=>generateComposition({...timeline,clips:[{...clip,blendMode:'bad;}</style><script>' as never}]},[])).toThrow('blend mode');
  });
});
