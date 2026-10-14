import { describe, expect, test } from 'vitest';
import { calculateVisualRect, compositionTrackIndex, layerZIndex, generateComposition } from './composition';
import type { Timeline } from './types';

const timeline: Timeline = { fps: 30, aspectRatio: 'vertical', clips: [{ id: 'caption', kind: 'caption', start: 0, duration: 2, sourceStart: 0, text: '</script><img src=x onerror=alert(1)>', animation: 'rise' }] };

describe('trusted composition generation', () => {
  test('text and transitions share one optional scene renderer while legacy explicit URLs remain supported',()=>{
    const html=generateComposition(timeline,[]);
    expect(html).toContain('src="/vendor/remotion-runtime.js"');
    expect(html).not.toContain('src="/vendor/remotion-text.js"');
    expect(html).not.toContain('src="/vendor/remotion-transitions.js"');
    const legacy=generateComposition(timeline,[],{remotionTextUrl:'./remotion-text.js'});
    expect(legacy).toContain('src="./remotion-text.js"');
    expect(legacy).not.toContain('src="/vendor/remotion-runtime.js"');
  });
  test('export renders configured bar height with movement speed independent of its hold', () => {
    const html = generateComposition({ ...timeline, clips: [...timeline.clips, { id: 'bars', kind: 'effect', effectPreset: 'cinematic-bars', cinematicBars: { size: .2, speed: 2 }, start: 1, duration: 4, sourceStart: 0, track: 3 }] }, []);
    expect(html).toContain('class="cinematic-bar top" style="height:20%"');
    expect(html).toContain('class="cinematic-bar bottom" style="height:20%"');
    expect(html).toContain('installAdjustmentLayers(');
    expect(html).toContain('\"cinematicBars\":{\"size\":0.2,\"speed\":2}');
  });
  test('escapes user text and preserves deterministic timing', () => {
    const html = generateComposition(timeline, []);
    expect(html).toContain('&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('data-duration="2"');
    expect(html).toContain('window.__timelines.revline=timeline');
  });
  test('keeps source trimming and volume in the shared HTML', () => {
    const html = generateComposition({ ...timeline, clips: [{ id: 'video', kind: 'video', assetId: 'asset', start: 1, duration: 2, sourceStart: 3, volume: 0.25 }] }, [{ _id: 'asset', fileName: 'clip.mp4', kind: 'video', url: 'https://example.com/clip.mp4' }]);
    expect(html).toContain('data-start="1" data-duration="2"');
    expect(html).toContain('data-media-start="3" data-volume="0.25"');
  });
  test('carries per-clip playback speed into native preview and pitch-preserving export', () => {
    const asset = { _id: 'asset', fileName: 'clip.mp4', kind: 'video' as const, url: '/clip.mp4' };
    const clip = { id: 'video', kind: 'video' as const, assetId: 'asset', start: 1, duration: 2, sourceStart: 3, playbackRate: 2 };
    const html = generateComposition({ ...timeline, clips: [clip] }, [asset]);
    expect(html).toContain('data-playback-rate="2"');
    expect(html).toContain('media.preservesPitch=true');
    expect(() => generateComposition({ ...timeline, clips: [{ ...clip, playbackRate: Infinity }] }, [asset])).toThrow('playback speed');
  });
  test('preserves above-unity gain for playback and export without violating native media limits', () => {
    const html = generateComposition({ ...timeline, clips: [{ id: 'audio', kind: 'audio', assetId: 'asset', start: 0, duration: 2, sourceStart: 0, volume: 2 }] }, [{ _id: 'asset', fileName: 'tone.wav', kind: 'audio', url: '/tone.wav' }]);
    expect(html).toContain('data-volume="2"');
    expect(html).toContain('media.volume=Math.min(1,Number(media.dataset.volume))');
  });
  test('rejects unavailable media, unsafe URLs, and unbounded duration', () => {
    const clip = { id: 'video', kind: 'video' as const, assetId: 'asset', start: 0, duration: 2, sourceStart: 0 };
    expect(() => generateComposition({ ...timeline, clips: [clip] }, [])).toThrow('unavailable');
    expect(() => generateComposition({ ...timeline, clips: [clip] }, [{ _id: 'asset', kind: 'video', fileName: 'clip', url: 'javascript:alert(1)' }])).toThrow('URLs');
    expect(() => generateComposition({ ...timeline, clips: [{ ...timeline.clips[0], duration: Infinity }] }, [])).toThrow('finite');
  });
  test('converts source focus coordinates into each frame crop', () => {
    const middle=calculateVisualRect(1920,1080,1080,1920,undefined,{x:.5,y:.9});
    const left=calculateVisualRect(1920,1080,1080,1920,undefined,{x:.1,y:.5});
    const right=calculateVisualRect(1920,1080,1080,1920,undefined,{x:.9,y:.5});
    expect(middle.left).toBeCloseTo((1080-middle.width)/2);expect(middle.top).toBeCloseTo(0);
    expect(left.left).toBeCloseTo(0);expect(right.left).toBeCloseTo(1080-right.width);
    const landscape=calculateVisualRect(1080,1920,1920,1080,undefined,{x:.1,y:.9});
    expect(landscape.left).toBeCloseTo(0);expect(landscape.top).toBeCloseTo(1080-landscape.height);
  });
  test('interpolates focus at source trim boundaries and maps it to clip timeline time', () => {
    const html = generateComposition({ ...timeline, clips: [{ id: 'track', kind: 'video', assetId: 'asset', start: 5, duration: 2, sourceStart: 2, focus: [{ time: 0, x: 0, y: 0.5 }, { time: 4, x: 1, y: 0.5 }] }] }, [{ _id: 'asset', kind: 'video', fileName: 'source.mp4', url: '/source.mp4', width: 1920, height: 1080 }]);
    expect(html).toContain("timeline.set('#clip-0',{left:-1166.6666666666665,top:0},5)");
    expect(html).toContain("left:-2333.333333333333,top:0,duration:2,ease:'none'},5)");
    expect(html).not.toContain('duration:4');
  });
  test('maps source-space tracking samples through slowed or accelerated clip time', () => {
    const asset = { _id: 'asset', kind: 'video' as const, fileName: 'source.mp4', url: '/source.mp4', width: 1920, height: 1080 };
    const clip = { id: 'track', kind: 'video' as const, assetId: 'asset', start: 5, duration: 1, sourceStart: 2, playbackRate: 2, focus: [{ time: 0, x: 0, y: .5 }, { time: 4, x: 1, y: .5 }] };
    const fast = generateComposition({ ...timeline, clips: [clip] }, [asset]);
    expect(fast).toContain("left:-2333.333333333333,top:0,duration:1,ease:'none'},5)");
    const slow = generateComposition({ ...timeline, clips: [{ ...clip, duration: 4, playbackRate: .5 }] }, [asset]);
    expect(slow).toContain("left:-2333.333333333333,top:0,duration:4,ease:'none'},5)");
  });
  test('uses the actual export font from the preview origin', () => {
    expect(generateComposition(timeline, [], { gsapUrl: 'https://editor.example/vendor/gsap.min.js' })).toContain("src:url('https://editor.example/fonts/space-grotesk-latin.woff2')");
  });
  test('loads the shared live text renderer with safely serialized entrances', () => {
    const html = generateComposition(timeline, []);
    expect(html).not.toContain('autoAlpha');
    expect(html).not.toContain('visibility:hidden');
    expect(html).toContain('installTextLayers(');
    expect(html).toContain('"animation":"rise"');
  });
});

describe('stacked visual geometry', () => {
  test('higher layers win even when earlier in the clip array', () => {
    expect(layerZIndex({kind:'image',track:2},0)).toBeGreaterThan(layerZIndex({kind:'video',track:1},199));
    expect(layerZIndex({kind:'image',track:12},0)).toBeGreaterThan(layerZIndex({kind:'graphic',track:1},199));
    expect(layerZIndex({kind:'caption',track:3},0)).toBeGreaterThan(layerZIndex({kind:'video',track:2},199));
    expect(layerZIndex({kind:'video',track:2},1)).toBeGreaterThan(layerZIndex({kind:'caption',track:2},0));
  });
  test('normalizes legacy text rows above old footage without changing source timing', () => {
    const legacy: Timeline = { fps:30,aspectRatio:'vertical',tracks:{visual:2,overlay:1,audio:1},clips:[
      {id:'footage',kind:'video',track:2,assetId:'a',start:1,duration:2,sourceStart:3},
      {id:'words',kind:'graphic',track:1,start:1,duration:2,sourceStart:0,text:'Above footage'},
    ] };
    const html = generateComposition(legacy,[{_id:'a',kind:'video',fileName:'a.mp4',url:'/a.mp4'}]);
    expect(html).toContain('data-track-index="1"');
    expect(html).toContain('data-text-clip="words" class="overlay graphic"');
    expect(html).toContain(`z-index:${layerZIndex({kind:'graphic',track:3},1)}`);
    expect(html).toContain('data-start="1" data-duration="2"');
    expect(html).toContain('data-media-start="3"');
    expect(legacy.clips[1].track).toBe(1);
  });
  test('renders footage above text when its shared visual row is higher', () => {
    const mixed: Timeline = {fps:30,aspectRatio:'vertical',tracks:{visual:3,overlay:0,audio:1},clips:[
      {id:'words',kind:'caption',track:1,start:0,duration:2,sourceStart:0,text:'Behind footage'},
      {id:'footage',kind:'video',track:3,assetId:'a',start:0,duration:2,sourceStart:0},
    ]};
    const html=generateComposition(mixed,[{_id:'a',kind:'video',fileName:'a.mp4',url:'/a.mp4'}]);
    expect(html).toMatch(new RegExp(`class="overlay caption" style="[^"]*z-index:${layerZIndex(mixed.clips[0],0)};`));
    expect(html).toContain(`opacity:1;z-index:${layerZIndex(mixed.clips[1],1)}`);
    expect(layerZIndex(mixed.clips[1],1)).toBeGreaterThan(layerZIndex(mixed.clips[0],0));
  });
  test('partitions 24 shared visual tracks and 12 audio tracks without collisions', () => {
    expect(compositionTrackIndex({kind:'video',track:24})).toBe(23);
    expect(compositionTrackIndex({kind:'caption',track:24})).toBe(23);
    expect(compositionTrackIndex({kind:'graphic',track:4})).toBe(compositionTrackIndex({kind:'image',track:4}));
    expect(compositionTrackIndex({kind:'audio',track:1})).toBe(24);
    expect(compositionTrackIndex({kind:'audio',track:12})).toBe(35);
  });
  test('source focus and scale remain unchanged when crop edges are masked', () => {
    const crop = {left:2/3,top:0,right:0,bottom:0};
    const before=calculateVisualRect(1920,1080,720,1280,undefined,{x:0,y:.5});
    const rect=calculateVisualRect(1920,1080,720,1280,crop,{x:0,y:.5});
    expect(rect.left).toBe(before.left); expect(rect.width).toBe(before.width);
    expect(rect.window.width).toBe(0); // The retained region is outside the existing viewport.
    expect(() => calculateVisualRect(1920,1080,720,1280,{left:.5,right:.45,top:0,bottom:0})).toThrow('5%');
  });
  test('contains the true cropped region and masks removed pixels in the letterbox', () => {
    const rect = calculateVisualRect(1920,1080,720,1280,{left:2/3,top:0,right:0,bottom:0},undefined,'contain');
    expect(rect.width).toBeCloseTo(720);
    expect(rect.height).toBeCloseTo(405);
    expect(rect.left).toBeCloseTo(0);
    expect(rect.top).toBeCloseTo(437.5);
    expect(rect.window.top).toBeCloseTo(437.5);
    expect(rect.window.height).toBeCloseTo(405);
    expect(rect.window.width).toBe(240);
    const html = generateComposition({...timeline,clips:[{id:'crop',kind:'image',assetId:'a',start:0,duration:1,sourceStart:0,crop:{left:2/3,top:0,right:0,bottom:0},fit:'contain',transform:{x:.75,y:.25,scale:.3,rotation:15,opacity:.5}}]},[{_id:'a',kind:'image',fileName:'a',url:'/a.png',width:1920,height:1080}],{resolution:720});
    expect(html).toContain('class="source-window" style="left:480px;top:437.5px;width:240px;height:405px"');
    expect(html).toContain('transform:rotate(15deg) scale(0.3);opacity:0.5');
    expect(html).not.toContain('clip-path');
  });
});
