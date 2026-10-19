import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { SmoothZoomControls } from './smooth-zoom-controls';
import { FootageSettings } from './footage-settings';
import type { Clip, MediaAsset } from '@/lib/editor/types';
import { dimensions, type AspectRatio, type Timeline } from '@/lib/editor/types';
import { applyTwoRowLayout, twoRowLayoutPatch } from '@/lib/editor/two-row-layout';
import { calculateVisualRect } from '@/lib/editor/visual-source-geometry';
import { visualBounds } from '@/lib/editor/visual-transforms';

const clip: Clip = { id: 'clip', kind: 'image', assetId: 'source', start: 0, duration: 4, sourceStart: 0 };
const asset: MediaAsset = { _id: 'source', kind: 'image', fileName: 'source.svg', url: '/source.svg', width: 1920, height: 1080 };
afterEach(() => vi.unstubAllEnvs());

it('keeps manual zoom controls entirely out of the production inspector', () => {
  vi.stubEnv('NODE_ENV', 'production');
  expect(renderToStaticMarkup(<SmoothZoomControls clip={clip} asset={asset} aspectRatio="landscape" fps={30} onChange={() => {}} />)).toBe('');
  expect(renderToStaticMarkup(<FootageSettings clip={clip} asset={asset} aspectRatio="landscape" fps={30} cropping={false} onCrop={() => {}} onChange={() => {}} />)).not.toContain('Smooth zoom');
});

it('mounts in real footage settings only in development and disables authoring while cropped or locked', () => {
  vi.stubEnv('NODE_ENV', 'development');
  for (const state of [{ cropping: true }, { cropping: false, readOnly: true }]) {
    const html = renderToStaticMarkup(<FootageSettings clip={clip} asset={asset} aspectRatio="landscape" fps={30} onCrop={() => {}} onChange={() => {}} {...state} />);
    expect(html).toContain('Smooth zoom keyframes');
    expect(html).toMatch(/aria-label="Zoom start"[^>]*disabled/);
    expect(html).toMatch(/disabled=""[^>]*>Apply zoom/);
  }
});

it('provides entry, hold, exit, normalized original-source focus and easing in development', () => {
  vi.stubEnv('NODE_ENV', 'development');
  const html = renderToStaticMarkup(<SmoothZoomControls clip={clip} asset={asset} aspectRatio="landscape" fps={30} onChange={() => {}} />);
  for (const label of ['Zoom start', 'Zoom in', 'Hold', 'Zoom out', 'Source focus X', 'Source focus Y', 'Zoom easing', 'Apply zoom']) expect(html).toContain(label);
  expect(html).toContain('Set Zoom out to 0 to stay zoomed in');
});

it('fills exact top and bottom half-canvas rows without stretching common source shapes',()=>{
  for(const aspectRatio of ['vertical','portrait-feed','square','classic','landscape'] as AspectRatio[])for(const [width,height]of [[1920,1080],[1080,1920],[1200,1200]])for(const row of ['top','bottom'] as const){
    const source={...asset,width,height},patch=twoRowLayoutPatch(clip,source,aspectRatio,row),canvas=dimensions(aspectRatio);
    const rect=calculateVisualRect(width,height,canvas.width,canvas.height,patch.crop,undefined,patch.fit);
    const bounds=visualBounds(patch.transform!,rect.window,canvas.width,canvas.height);
    expect(bounds.width).toBeCloseTo(canvas.width,8);expect(bounds.height).toBeCloseTo(canvas.height/2,8);
    expect(bounds.cx).toBeCloseTo(canvas.width/2,8);expect(bounds.cy).toBeCloseTo(canvas.height*(row==='top'?.25:.75),8);
    expect(rect.width/rect.height).toBeCloseTo(width/height,12);
  }
});

it('assigns exact row clip IDs and preserves source timing, linked audio, effects and other clips',()=>{
  const narrator:Clip={...clip,id:'narrator',kind:'video',assetId:'narrator-source',start:2,duration:8,sourceStart:4,playbackRate:1.5,volume:.7,linkedClipId:'narration',transform:{x:.4,y:.4,scale:1.2,rotation:12,opacity:.6}};
  const audio:Clip={id:'narration',kind:'audio',assetId:'sound',start:2,duration:8,sourceStart:4,linkedClipId:'narrator',volume:.7};
  const title:Clip={id:'title',kind:'caption',start:3,duration:1,sourceStart:0,text:'Keep me'};
  const timeline:Timeline={aspectRatio:'vertical',fps:60,clips:[clip,narrator,audio,title]};
  const next=applyTwoRowLayout(timeline,[asset,{...asset,_id:'narrator-source',kind:'video',width:1080,height:1920}],{topClipIds:[clip.id],bottomClipIds:[narrator.id]});
  expect(next.clips[0].transform?.y).toBe(.25);expect(next.clips[1].transform?.y).toBe(.75);
  expect(next.clips[1]).toMatchObject({start:2,duration:8,sourceStart:4,playbackRate:1.5,volume:.7,linkedClipId:'narration',transform:{opacity:.6,rotation:0}});
  expect(next.clips[2]).toBe(audio);expect(next.clips[3]).toBe(title);expect(next.fps).toBe(60);expect(timeline.clips[1]).toBe(narrator);
  expect(()=>applyTwoRowLayout(timeline,[asset],{topClipIds:['clip'],bottomClipIds:['clip']})).toThrow('only once');
  expect(()=>applyTwoRowLayout(timeline,[asset],{topClipIds:['missing'],bottomClipIds:[]})).toThrow('no longer');
  expect(()=>twoRowLayoutPatch({...clip,motion:[{time:0,x:0,y:0,scale:1,rotation:0,opacity:1,brightness:1}]},asset,'vertical','top')).toThrow('custom motion');
  expect(()=>twoRowLayoutPatch(clip,{...asset,width:undefined},'vertical','top')).toThrow('dimensions');
});

it('offers row presets in the real production footage inspector and locks them while editing is unavailable',()=>{
  vi.stubEnv('NODE_ENV','production');
  const props={clip,asset,aspectRatio:'vertical' as const,fps:30,cropping:false,onCrop:()=>{},onChange:()=>{}};
  const html=renderToStaticMarkup(<FootageSettings {...props}/>);
  expect(html).toContain('aria-label="Two-row layout"');expect(html).toContain('Top row');expect(html).toContain('Bottom row');
  for(const state of [{readOnly:true},{cropping:true}]){
    const locked=renderToStaticMarkup(<FootageSettings {...props} {...state}/>);
    expect(locked).toMatch(/disabled=""[^>]*>Top row/);expect(locked).toMatch(/disabled=""[^>]*>Bottom row/);
  }
});
