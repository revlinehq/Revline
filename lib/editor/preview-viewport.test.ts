import { describe, expect, it } from 'vitest';
import { DEFAULT_TRANSFORM, type Timeline, type MediaAsset } from './types';
import { isPreviewTextOccluded, previewClipAtPoint, visibleVisualBounds, visualClipAtPoint } from './preview-viewport';

const canvas = { width: 1080, height: 1920 };
const full = { left: 0, top: 0, ...canvas };

describe('visible preview content bounds', () => {
  it('matches the normal Fill composition', () => {
    const value = visibleVisualBounds(DEFAULT_TRANSFORM, full, canvas)!;
    expect(value.rect).toEqual(full);
    expect(value.clipped).toBe(false);
  });

  it('matches retained Fit media, rather than its full composition wrapper', () => {
    const rect = { left: 0, top: 656.25, width: 1080, height: 607.5 };
    expect(visibleVisualBounds(DEFAULT_TRANSFORM, rect, canvas)!.rect).toEqual(rect);
  });

  it('clips the enlarged source at the exact mask that paints the preview', () => {
    const value = visibleVisualBounds({ ...DEFAULT_TRANSFORM, x: .9, y: .9, scale: 1.8 }, full, canvas)!;
    expect(value.rect.left).toBeCloseTo(0);
    expect(value.rect.top).toBeCloseTo(0);
    expect(value.rect.width).toBeCloseTo(canvas.width);
    expect(value.rect.height).toBeCloseTo(canvas.height);
    expect(value.clipped).toBe(true);
    expect(value.corners.se).toEqual({ x: 1080, y: 1920 });
  });

  it('clips rotated media as a polygon, not its unrotated or enclosing rectangle', () => {
    const value = visibleVisualBounds({ ...DEFAULT_TRANSFORM, rotation: 45 }, full, canvas)!;
    expect(value.points.length).toBeGreaterThan(4);
    expect(value.points.every(point => point.x >= 0 && point.x <= canvas.width && point.y >= 0 && point.y <= canvas.height)).toBe(true);
    expect(value.rect.width).toBeCloseTo(canvas.width);
    expect(value.rect.height).toBeCloseTo(canvas.height);
    expect(value.points.some(point => point.x === 0 && point.y > 0)).toBe(true);
  });

  it('preserves a partially visible cropped source and its canonical transform', () => {
    const transform = { ...DEFAULT_TRANSFORM, x: 1, y: 1, scale: 2 };
    const value = visibleVisualBounds(transform, { left: 200, top: 300, width: 500, height: 800 }, canvas)!;
    expect(value.rect).toEqual({ left: 400, top: 600, width: 680, height: 1320 });
    expect(transform).toEqual({ ...DEFAULT_TRANSFORM, x: 1, y: 1, scale: 2 });
  });

  it('does not provide a ghost selection for completely masked media', () => {
    expect(visibleVisualBounds({ ...DEFAULT_TRANSFORM, x: 1, y: 1, scale: .1 }, { left: 900, top: 1700, width: 100, height: 100 }, canvas)).toBeNull();
  });
});

describe('selecting footage directly in the preview', () => {
  const assets: MediaAsset[] = [{_id:'wide',fileName:'wide.png',kind:'image',url:'/wide.png',width:1920,height:1080}];
  const base: Timeline = {fps:30,aspectRatio:'vertical',clips:[{id:'base',kind:'image',assetId:'wide',start:0,duration:4,sourceStart:0}]};
  it('picks the top active visual layer and leaves text selection to its controls', () => {
    const timeline: Timeline = {...base,clips:[{...base.clips[0],id:'upper',track:2},{...base.clips[0],id:'lower',track:1},{id:'text',kind:'caption',start:0,duration:4,sourceStart:0,text:'Caption'}]};
    expect(visualClipAtPoint(timeline,assets,1,{x:540,y:960})?.id).toBe('upper');
  });
  it('does not select media through its contain-fit letterboxing', () => {
    const timeline: Timeline = {...base,clips:[{...base.clips[0],fit:'contain'}]};
    expect(visualClipAtPoint(timeline,assets,1,{x:540,y:100})).toBeUndefined();
    expect(visualClipAtPoint(timeline,assets,1,{x:540,y:960})?.id).toBe('base');
  });
  it('uses the painted rotated polygon rather than its enclosing rectangle', () => {
    const timeline: Timeline = {...base,clips:[{...base.clips[0],transform:{...DEFAULT_TRANSFORM,scale:.3,rotation:45}}]};
    expect(visualClipAtPoint(timeline,assets,1,{x:300,y:720})).toBeUndefined();
    expect(visualClipAtPoint(timeline,assets,1,{x:540,y:960})?.id).toBe('base');
  });
  it('honors clip boundaries and ignores fully transparent media', () => {
    const timeline: Timeline = {...base,clips:[{...base.clips[0],duration:1},{...base.clips[0],id:'next',start:1},{...base.clips[0],id:'hidden',track:2,transform:{...DEFAULT_TRANSFORM,opacity:0}}]};
    expect(visualClipAtPoint(timeline,assets,1,{x:540,y:960})?.id).toBe('next');
    expect(visualClipAtPoint(timeline,assets,8,{x:540,y:960})).toBeUndefined();
  });
  it('selects footage above text using the same mixed-track order as rendering', () => {
    const words={id:'words',kind:'caption' as const,track:1,start:0,duration:4,sourceStart:0,text:'Behind footage'};
    const timeline: Timeline={...base,tracks:{visual:3,overlay:0,audio:1},clips:[words,{...base.clips[0],track:3}]};
    const textBounds=[{id:'words',rect:{left:400,top:900,width:280,height:120}}];
    expect(previewClipAtPoint(timeline,assets,1,{x:540,y:960},textBounds)?.id).toBe('base');
    expect(previewClipAtPoint({...timeline,clips:[{...words,track:4},timeline.clips[1]],tracks:{visual:4,overlay:0,audio:1}},assets,1,{x:540,y:960},textBounds)?.id).toBe('words');
  });
  it('retains legacy text stacking and uses array order only to break a shared-row tie', () => {
    const words={id:'words',kind:'graphic' as const,track:1,start:0,duration:4,sourceStart:0,text:'Text'};
    const textBounds=[{id:'words',rect:{left:400,top:900,width:280,height:120}}];
    const legacy: Timeline={...base,tracks:{visual:1,overlay:1,audio:1},clips:[words,base.clips[0]]};
    expect(previewClipAtPoint(legacy,assets,1,{x:540,y:960},textBounds)?.id).toBe('words');
    const mixed: Timeline={...legacy,tracks:{visual:1,overlay:0,audio:1}};
    expect(previewClipAtPoint(mixed,assets,1,{x:540,y:960},textBounds)?.id).toBe('base');
    expect(previewClipAtPoint({...mixed,clips:[base.clips[0],words]},assets,1,{x:540,y:960},textBounds)?.id).toBe('words');
  });
  it('selects visible text through a higher fitted media layer’s letterbox', () => {
    const timeline:Timeline={...base,tracks:{visual:2,overlay:0,audio:1},clips:[{id:'words',kind:'graphic',track:1,start:0,duration:4,sourceStart:0,text:'Above letterbox'},{...base.clips[0],track:2,fit:'contain'}]};
    const bounds=[{id:'words',rect:{left:400,top:40,width:280,height:120}}];
    expect(previewClipAtPoint(timeline,assets,1,{x:540,y:100},bounds)?.id).toBe('words');
    expect(previewClipAtPoint(timeline,assets,1,{x:540,y:960},bounds)?.id).toBe('base');
  });
  it('removes only text hit targets fully covered by opaque footage above them', () => {
    const words={id:'words',kind:'graphic' as const,track:1,start:0,duration:4,sourceStart:0,text:'Text'};
    const mixed:Timeline={...base,tracks:{visual:2,overlay:0,audio:1},clips:[words,{...base.clips[0],track:2}]};
    const rect={left:400,top:40,width:280,height:120};
    expect(isPreviewTextOccluded(mixed,assets,1,'words',rect)).toBe(true);
    expect(isPreviewTextOccluded({...mixed,clips:[words,{...mixed.clips[1],fit:'contain'}]},assets,1,'words',rect)).toBe(false);
    expect(isPreviewTextOccluded({...mixed,clips:[words,{...mixed.clips[1],transform:{...DEFAULT_TRANSFORM,opacity:.5}}]},assets,1,'words',rect)).toBe(false);
    expect(isPreviewTextOccluded({...mixed,clips:[{...words,track:3},mixed.clips[1]],tracks:{visual:3,overlay:0,audio:1}},assets,1,'words',rect)).toBe(false);
  });
});

describe('selecting visibly contributing stacked footage', () => {
  const assets:MediaAsset[]=[{_id:'gif',kind:'image',fileName:'generated.png',url:'/generated.png',width:356,height:200}];
  const lower={id:'lower',kind:'image' as const,assetId:'gif',track:2,start:6.6,duration:4.763265,sourceStart:0,fit:'contain' as const,transform:{opacity:1,rotation:0,scale:2.0924407074563964,x:.6462951644673953,y:.5405556138071702}};
  const upper={...lower,id:'upper',track:3,transform:{opacity:.12,rotation:0,scale:3.767347579629565,x:.7135288806841728,y:.5952620824555142}};
  const timeline:Timeline={fps:30,aspectRatio:'vertical',tracks:{visual:3,overlay:0,audio:0,effects:0},clips:[lower,upper]};
  const point={x:540,y:960};
  it('selects the bright lower clip through its faint enlarged duplicate',()=>{
    expect(previewClipAtPoint(timeline,assets,11,point)?.id).toBe('lower');
  });
  it('preserves opaque upper selection and uses upper z-order to break equal contributions',()=>{
    for(const opacity of [1,.5])expect(previewClipAtPoint({...timeline,clips:[lower,{...upper,transform:{...upper.transform,opacity}}]},assets,11,point)?.id).toBe('upper');
  });
  it('weights lower contributions by every overlapping media layer above them',()=>{
    const middle={...lower,id:'middle',track:3,transform:{...lower.transform,opacity:.4}};
    const top={...upper,track:4,transform:{...upper.transform,opacity:.2}};
    expect(previewClipAtPoint({...timeline,tracks:{visual:4,overlay:0,audio:0},clips:[{...lower,transform:{...lower.transform,opacity:.9}},middle,top]},assets,11,point)?.id).toBe('lower');
  });
  it('cycles through geometric overlaps without making faint upper media unselectable',()=>{
    expect(previewClipAtPoint(timeline,assets,11,point,[],{cycleAfter:'lower'})?.id).toBe('upper');
    expect(previewClipAtPoint(timeline,assets,11,point,[],{cycleAfter:'upper'})?.id).toBe('lower');
    expect(previewClipAtPoint(timeline,assets,11,point,[],{cycleAfter:null})?.id).toBe('upper');
  });
  it('uses current rendered opacity for draft and animated layers, including backwards seeks',()=>{
    const mediaOpacities=new Map([['lower',1],['upper',0]]);
    expect(previewClipAtPoint(timeline,assets,11,point,[],{mediaOpacities})?.id).toBe('lower');
    mediaOpacities.set('upper',.8);
    expect(previewClipAtPoint(timeline,assets,11,point,[],{mediaOpacities})?.id).toBe('upper');
    mediaOpacities.set('upper',0);
    expect(previewClipAtPoint(timeline,assets,11,point,[],{cycleAfter:'lower',mediaOpacities})?.id).toBe('lower');
  });
});
