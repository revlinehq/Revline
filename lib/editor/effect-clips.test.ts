import { expect, test } from 'vitest';
import { EFFECT_PRESETS, motionAt, visibleMotion } from './clip-effects';
import { addEffectClip, splitClip, duplicateClip } from './operations';
import { resizeSelectedClips, moveSelectedClips } from './timeline-controls';
import { clipColor, deriveTrackCounts, deriveTracks, normalizeTimeline, type Timeline } from './types';
import { createEditorStore } from './store';
import { copyTimelineClips, pasteTimelineClips } from './clipboard';
import { generateComposition } from './composition';

const timeline: Timeline = { fps: 30, aspectRatio: 'landscape', tracks: { visual: 1, overlay: 0, audio: 0 }, clips: [{ id: 'footage', kind: 'graphic', text: 'Footage placeholder', start: 0, duration: 20, sourceStart: 0, track: 1 }] };

test.each(EFFECT_PRESETS)('%s is an independent effect at the playhead on an FX track', preset => {
  const next = addEffectClip(timeline, 'effect', preset, 10, { aboveClipId: 'footage' });
  expect(next.clips[0]).toEqual(timeline.clips[0]);
  expect(next.clips[1]).toMatchObject({ kind: 'effect', start: 10, track: 1, effectPreset: preset, sourceStart: 0 });
  expect(next.tracks?.visual).toBe(1);expect(next.tracks?.effects).toBe(1);
  expect(next.clips[1].motion?.length).toBeGreaterThan(1);
  expect(clipColor('effect')).not.toBe(clipColor('video'));
  const moved = moveSelectedClips(next, ['effect'], 2, 0);
  expect(moved.clips[1].start).toBe(12);
  expect(moved.clips[0]).toEqual(timeline.clips[0]);
});

test('full visual capacity does not constrain FX placement, collision, copying or undo', () => {
  const full:Timeline={...timeline,tracks:{visual:24,overlay:0,audio:1},clips:[
    {...timeline.clips[0],track:24},
    {id:'audio',kind:'audio',track:1,start:0,duration:20,sourceStart:2,volume:.8},
  ]};
  const first=addEffectClip(full,'flash','flash',2,{aboveClipId:'footage',duration:1});
  const second=addEffectClip(first,'bars','cinematic-bars',2,{duration:2});
  const later=addEffectClip(second,'later','punch',10,{duration:1});
  expect(later.clips.slice(0,2)).toEqual(full.clips);
  expect(later.clips.slice(2).map(clip=>[clip.id,clip.track,clip.start])).toEqual([['flash',1,2],['bars',2,2],['later',1,10]]);
  expect(deriveTrackCounts(later)).toEqual({visual:24,overlay:0,audio:1,effects:2});
  const duplicate=duplicateClip(later,'bars','copy');
  const pasted=pasteTimelineClips(duplicate,copyTimelineClips(later,['bars']),2,()=> 'pasted').timeline;
  expect(pasted.clips.find(clip=>clip.id==='pasted')).toMatchObject({kind:'effect',effectPreset:'cinematic-bars',track:3,start:2,duration:2});
  expect(pasted.clips.slice(0,2)).toEqual(full.clips);
  const store=createEditorStore(full);store.getState().edit(pasted);
  expect(store.getState().undo()).toEqual(full);
  expect(store.getState().redo()).toEqual(pasted);
});

test('legacy effects infer separate FX rows without renumbering existing clips or rows', () => {
  const legacy:Timeline={...timeline,tracks:{visual:3,overlay:0,audio:1},clips:[
    {...timeline.clips[0],track:3},
    {id:'text',kind:'caption',track:2,start:1.25,duration:2.5,sourceStart:0,text:'Original'},
    {id:'effect',kind:'effect',track:24,start:2.5,duration:.5,sourceStart:0,effectPreset:'flash'},
  ]};
  expect(normalizeTimeline(legacy).clips).toEqual(legacy.clips);
  expect(deriveTrackCounts(legacy)).toEqual({visual:3,overlay:0,audio:1,effects:24});
  const rows=deriveTracks(legacy);
  expect(rows[0].label).toBe('FX24');expect(rows[23].label).toBe('FX1');
  expect(rows.slice(24).map(row=>row.label)).toEqual(['V3','V2','V1','A1']);
});

test('separated-overlay compatibility keeps historical text offsets while new FX can use track 24', () => {
  const clips:Timeline['clips']=[{...timeline.clips[0],kind:'video',assetId:'video'},
    {id:'caption',kind:'caption',track:2,start:0,duration:2,sourceStart:0,text:'Keep order'},
    {id:'effect',kind:'effect',track:3,start:1,duration:1,sourceStart:0,effectPreset:'flash'},
  ];
  const historical=normalizeTimeline({fps:30,aspectRatio:'landscape',clips});
  expect(historical.clips.map(clip=>clip.track)).toEqual([1,5,3]);
  for(const tracks of [undefined,{visual:1,overlay:2,audio:0,effects:24}]) {
    const newFx=normalizeTimeline({fps:30,aspectRatio:'landscape',tracks,clips:clips.map(clip=>clip.kind==='effect'?{...clip,track:24}:clip)});
    expect(newFx.clips.map(clip=>clip.track)).toEqual([1,3,24]);expect(deriveTrackCounts(newFx).effects).toBe(24);
  }
});

test('bar resizing extends the hold without slowing movement, while splits retain their phase', () => {
  const next = addEffectClip(timeline, 'effect', 'cinematic-bars', 10, { duration: 2 });
  const effect = next.clips[1];
  const resized = resizeSelectedClips(next, [], ['effect'], 'right', 2).clips[1];
  expect(resized.duration).toBe(4);
  expect(resized.motion?.at(-1)?.time).toBe(4);
  expect(motionAt(resized.motion!, .2).opacity).toBeCloseTo(.5);
  expect(motionAt(resized.motion!, .4).opacity).toBe(motionAt(effect.motion!, .4).opacity);
  expect(motionAt(resized.motion!, 3.6).opacity).toBe(1);
  expect(motionAt(resized.motion!, 3.8).opacity).toBeCloseTo(.5);
  const left = resizeSelectedClips(next, [], ['effect'], 'left', -.5).clips[1];
  expect(left).toMatchObject({ start: 9.5, duration: 2.5, sourceStart: 0 });
  const split = splitClip(next, 'effect', 11, 'tail');
  const tail = split.clips.find(clip => clip.id === 'tail')!;
  expect(tail).toMatchObject({ sourceStart: 0, motionOffset: 1 });
  expect(visibleMotion(tail)[0].opacity).toBe(1);
  expect(visibleMotion(tail).at(-1)?.opacity).toBe(0);
});

test('effect wrappers never become timed roots that hide underlying footage', () => {
  const next = addEffectClip(timeline, 'effect', 'flash', 10, { duration: 1 });
  const html = generateComposition(next, []);
  expect(html).toContain('data-effect-clip="effect" class="adjustment-layer"');
  expect(html).not.toContain('id="clip-1" data-start=');
  expect(html).toContain("timeline.set('#clip-1-motion',");
  expect(html).toContain('"filter":"brightness(1)"},11)');
});
