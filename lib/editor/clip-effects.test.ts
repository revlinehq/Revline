import { describe, expect, it } from 'vitest';
import { motionPreset, motionAt, visibleMotion, validateClipEffects, MOTION_PRESETS, TIMED_EFFECT_PRESETS, NEUTRAL_MOTION } from './clip-effects';
import { adjustmentFrame } from './adjustment-layers';
import { splitClip } from './operations';
import { resizeSelectedClips } from './timeline-controls';
import { generateComposition } from './composition';
import type { Clip, Timeline } from './types';
const clip: Clip = { id:'word', kind:'graphic', text:'IMPACT', start:2, duration:2, sourceStart:0 };
const timeline: Timeline = { fps:30, aspectRatio:'vertical', tracks:{visual:1,overlay:0,audio:0}, clips:[clip] };
describe('clip motion',()=>{
  it('leaves inactive adjustment clips neutral without materializing their motion keys',()=>{
    for (const preset of ['quick-zoom-in','cinematic-bars'] as const) {
      const effect:Clip={id:'effect',kind:'effect',start:2,duration:2,sourceStart:0};
      const authored={...effect,...motionPreset(effect,preset)};
      const keys=authored.motion;let reads=0;
      Object.defineProperty(authored,'motion',{get(){reads++;return keys;}});
      for (const time of [0,2-1/30,4,10,0]) expect(adjustmentFrame(authored,time)).toBe(NEUTRAL_MOTION);
      expect(reads).toBe(0);
      const start=adjustmentFrame(authored,2),middle=adjustmentFrame(authored,3);
      expect(reads).toBeGreaterThan(0);
      expect(start.opacity).toBe(preset==='cinematic-bars'?0:1);
      expect(middle.opacity).toBe(1);
      expect(middle.scale).toBeCloseTo(preset==='quick-zoom-in'?1.1:1);
    }
  });
  it('all independent presets have bounded increasing keyframes, including one-frame clips',()=>{
    for (const duration of [1/60,1/30,2,60]) for (const preset of MOTION_PRESETS) expect(()=>validateClipEffects({...clip,duration,...motionPreset({...clip,duration},preset)})).not.toThrow();
    for (const duration of [1/60, .5, 2, 60]) for (const preset of TIMED_EFFECT_PRESETS) {
      const effect: Clip = { id: 'effect', kind: 'effect', start: 0, duration, sourceStart: 0 };
      expect(() => validateClipEffects({ ...effect, ...motionPreset(effect, preset) })).not.toThrow();
    }
  });
  it('quick zoom presets zoom in and out in opposite directions', () => {
    const effect: Clip = { id: 'effect', kind: 'effect', start: 0, duration: .5, sourceStart: 0 };
    const zoomIn = motionPreset(effect, 'quick-zoom-in').motion!;
    const zoomOut = motionPreset(effect, 'quick-zoom-out').motion!;
    expect([zoomIn[0].scale, zoomIn.at(-1)!.scale]).toEqual([1, 1.2]);
    expect([zoomOut[0].scale, zoomOut.at(-1)!.scale]).toEqual([1.2, 1]);
    expect(motionAt(zoomIn, .25).scale).toBeCloseTo(motionAt(zoomOut, .25).scale);
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
    expect(html).toContain('mix-blend-mode:screen');expect(html).toContain('installTextLayers(');
    expect(html).toContain('\"motion\":[');expect(html).toContain('class="text-motion"');
    expect(()=>generateComposition({...timeline,clips:[{...clip,blendMode:'bad;}</style><script>' as never}]},[])).toThrow('blend mode');
  });
});
