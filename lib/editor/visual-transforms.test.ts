import { describe, expect, test } from 'vitest';
import { cropToAspect, moveVisualTransform, resizeVisualTransform, sameVisualTransform, snapVisualMove, snapVisualResize, visualBounds, visualCornerPosition, visualTransform } from './visual-transforms';
import { DEFAULT_TRANSFORM } from './types';

describe('canvas manipulation geometry',()=>{
  test('crop presets retain the requested source aspect ratio',()=>{
    for(const ratio of [9/16,16/9,1,4/5,4/3]){
      const crop=cropToAspect(1920,1080,ratio);
      expect(1920*(1-crop.left-crop.right)/(1080*(1-crop.top-crop.bottom))).toBeCloseTo(ratio);
      expect(crop.left).toBe(crop.right);expect(crop.top).toBe(crop.bottom);
    }
  });
  test('preserves the opposite corner when resizing a rotated layer',()=>{
    const initial={...DEFAULT_TRANSFORM,scale:.4,rotation:90};
    const next=resizeVisualTransform(initial,'ne',72,72,720,720);
    expect(next.scale).toBeCloseTo(.5);expect(next.x).toBeCloseTo(.55);expect(next.y).toBeCloseTo(.55);expect(next.rotation).toBe(90);
    // NE rotates to the southeast; its opposite remains at 216px on both axes.
    expect(next.x*720-next.scale*360).toBeCloseTo(216);expect(next.y*720-next.scale*360).toBeCloseTo(216);
  });
  test('anchors the retained content corner instead of unused contain-fit canvas space',()=>{
    const initial={...DEFAULT_TRANSFORM,x:.4,y:.55,scale:.6};
    const rect={left:0,top:80,width:360,height:480};
    const next=resizeVisualTransform(initial,'se',20,20,360,640,rect);
    expect(next.x*360-next.scale*180).toBeCloseTo(initial.x*360-initial.scale*180);
    expect(next.y*640-next.scale*240).toBeCloseTo(initial.y*640-initial.scale*240);
  });
  test('anchors an offset content rectangle when resizing a rotated layer',()=>{
    const initial={...DEFAULT_TRANSFORM,x:.4,y:.55,scale:.6,rotation:30};
    const rect={left:40,top:80,width:240,height:480};
    const opposite=(value:typeof initial)=>{
      const angle=value.rotation*Math.PI/180,localX=rect.left-180,localY=rect.top-320;
      return{x:value.x*360+value.scale*(localX*Math.cos(angle)-localY*Math.sin(angle)),y:value.y*640+value.scale*(localX*Math.sin(angle)+localY*Math.cos(angle))};
    };
    const next=resizeVisualTransform(initial,'se',20,20,360,640,rect);
    expect(opposite(next).x).toBeCloseTo(opposite(initial).x);
    expect(opposite(next).y).toBeCloseTo(opposite(initial).y);
  });
  test('keeps portrait aspect and allows off-frame positioning within supported limits',()=>{
    const next=resizeVisualTransform({...DEFAULT_TRANSFORM,scale:.4},'se',36,64,360,640);
    expect(next.scale).toBeCloseTo(.5);expect(next.x).toBeCloseTo(.55);expect(next.y).toBeCloseTo(.55);
    const tiny=resizeVisualTransform(DEFAULT_TRANSFORM,'se',-10000,-10000,360,640);expect(tiny.scale).toBe(.1);
    const moved=moveVisualTransform(DEFAULT_TRANSFORM,1000,-1000,360,640);expect(moved.x).toBeCloseTo(.5+1000/360);expect(moved.y).toBeCloseTo(.5-1000/640);
  });
  test('recognizes unchanged gestures and clamped movement without hiding real edits',()=>{
    const initial=visualTransform();
    expect(sameVisualTransform(initial,visualTransform())).toBe(true);
    expect(sameVisualTransform(initial,moveVisualTransform(initial,0,0,360,640))).toBe(true);
    const clamped={...initial,x:-5,y:-5,scale:.1};
    expect(sameVisualTransform(clamped,moveVisualTransform(clamped,-20,-40,360,640))).toBe(true);
    expect(sameVisualTransform(clamped,resizeVisualTransform(clamped,'se',-100,-100,360,640))).toBe(true);
    expect(sameVisualTransform(initial,moveVisualTransform(initial,1,0,360,640))).toBe(false);
    expect(sameVisualTransform(initial,resizeVisualTransform(initial,'se',36,64,360,640))).toBe(false);
    expect(sameVisualTransform(initial,{...initial,rotation:45})).toBe(false);
    expect(sameVisualTransform(initial,{...initial,opacity:.5})).toBe(false);
  });
});

describe('preview alignment magnets',()=>{
  const canvas={width:360,height:640},rect={left:0,top:80,width:360,height:480};
  test('uses screen pixels for magnetic reach at different preview sizes',()=>{
    const proposed={...DEFAULT_TRANSFORM,x:.47,y:.52,scale:.6};
    const small=snapVisualMove(proposed,rect,canvas,{width:180,height:320});
    expect(small.transform.x).toBe(.5);expect(small.transform.y).toBe(.5);
    const large=snapVisualMove(proposed,rect,canvas,{width:720,height:1280});
    expect(large.transform).toEqual(proposed);expect(large.lines).toEqual([]);
  });
  test('aligns retained media edges instead of unused contain-fit space',()=>{
    const proposed={...DEFAULT_TRANSFORM,x:.205,y:.27,scale:.4};
    const result=snapVisualMove(proposed,rect,canvas,canvas);
    const bounds=visualBounds(result.transform,rect,canvas.width,canvas.height);
    expect(bounds.cx-bounds.width/2).toBeCloseTo(0);
    expect(result.lines).toContainEqual({axis:'x',position:0});
    expect(result.transform.scale).toBe(.4);
  });
  test('aligns visible centers for rotated and offset cropped media',()=>{
    const cropRect={left:40,top:80,width:240,height:480};
    const initial={...DEFAULT_TRANSFORM,x:.5,y:.5,scale:.6,rotation:30,opacity:.7};
    const bounds=visualBounds(initial,cropRect,canvas.width,canvas.height);
    const proposed={...initial,x:initial.x+(.5*canvas.width-bounds.cx-3)/canvas.width,y:initial.y+(.5*canvas.height-bounds.cy+4)/canvas.height};
    const result=snapVisualMove(proposed,cropRect,canvas,canvas),snapped=visualBounds(result.transform,cropRect,canvas.width,canvas.height);
    expect(snapped.cx).toBeCloseTo(180);expect(snapped.cy).toBeCloseTo(320);
    expect(result.transform.rotation).toBe(30);expect(result.transform.opacity).toBe(.7);
  });
  test('uniform resize snaps to an edge without moving the opposite corner',()=>{
    const full={left:0,top:0,...canvas},initial={...DEFAULT_TRANSFORM,x:.3,y:.3,scale:.4};
    const proposed=resizeVisualTransform(initial,'se',.496*canvas.width,.496*canvas.height,canvas.width,canvas.height,full);
    const result=snapVisualResize(initial,proposed,'se',full,canvas,{width:180,height:320});
    const before=visualCornerPosition(visualBounds(initial,full,canvas.width,canvas.height),'nw');
    const after=visualCornerPosition(visualBounds(result.transform,full,canvas.width,canvas.height),'nw');
    const dragged=visualCornerPosition(visualBounds(result.transform,full,canvas.width,canvas.height),'se');
    expect(result.transform.scale).toBeCloseTo(.9);expect(after.x).toBeCloseTo(before.x);expect(after.y).toBeCloseTo(before.y);
    expect(dragged.x).toBeCloseTo(360);expect(dragged.y).toBeCloseTo(640);
    expect(result.lines).toContainEqual({axis:'x',position:360});expect(result.lines).toContainEqual({axis:'y',position:640});
  });
  test('resizing rotated media locks the moving edge and retains the anchor',()=>{
    const size={width:100,height:100},full={left:0,top:0,...size},initial={...DEFAULT_TRANSFORM,x:.6,y:.4,scale:.4,rotation:90};
    const proposed=resizeVisualTransform(initial,'se',-39,39,100,100,full);
    const result=snapVisualResize(initial,proposed,'se',full,size,size);
    const before=visualCornerPosition(visualBounds(initial,full,100,100),'nw'),after=visualCornerPosition(visualBounds(result.transform,full,100,100),'nw');
    expect(result.transform.scale).toBeCloseTo(.8);expect(after.x).toBeCloseTo(before.x);expect(after.y).toBeCloseTo(before.y);
    expect(result.lines).toContainEqual({axis:'x',position:0});expect(result.lines).toContainEqual({axis:'y',position:100});
  });
  test('a noncentered rotated crop retains its opposite corner when snapping size',()=>{
    const cropped={left:40,top:80,width:240,height:480},initial={...DEFAULT_TRANSFORM,x:.4,y:.25,scale:.5,rotation:30};
    const angle=Math.PI/6,anchor=visualCornerPosition(visualBounds(initial,cropped,360,640),'nw');
    const targetScale=(360-anchor.x)/(cropped.width*Math.cos(angle));
    const delta=targetScale-.5-3/(cropped.width*Math.cos(angle));
    const proposed=resizeVisualTransform(initial,'se',(cropped.width*Math.cos(angle)-cropped.height*Math.sin(angle))*delta,(cropped.width*Math.sin(angle)+cropped.height*Math.cos(angle))*delta,360,640,cropped);
    const result=snapVisualResize(initial,proposed,'se',cropped,canvas,canvas);
    const retained=visualCornerPosition(visualBounds(result.transform,cropped,360,640),'nw');
    expect(result.transform.scale).toBeCloseTo(targetScale);expect(retained.x).toBeCloseTo(anchor.x);expect(retained.y).toBeCloseTo(anchor.y);
    expect(result.lines).toContainEqual({axis:'x',position:360});
  });
  test('does not snap a far resize or create invalid supported transforms',()=>{
    const full={left:0,top:0,...canvas},initial={...DEFAULT_TRANSFORM,x:.3,y:.3,scale:.4};
    const proposed=resizeVisualTransform(initial,'se',60,60,canvas.width,canvas.height,full);
    expect(snapVisualResize(initial,proposed,'se',full,canvas,canvas).transform).toEqual(proposed);
    const result=snapVisualMove({...DEFAULT_TRANSFORM,x:0,y:1,scale:5,rotation:30},rect,canvas,canvas);
    expect(result.transform.x).toBeGreaterThanOrEqual(0);expect(result.transform.x).toBeLessThanOrEqual(1);
    expect(result.transform.y).toBeGreaterThanOrEqual(0);expect(result.transform.y).toBeLessThanOrEqual(1);
  });
});

test('a framing drag can carry the layer center past every canvas edge',()=>{
 const moved=moveVisualTransform(DEFAULT_TRANSFORM,-360,640,360,640);
 expect(moved.x).toBeCloseTo(-.5);expect(moved.y).toBeCloseTo(1.5);
 const initial={...DEFAULT_TRANSFORM,x:1,y:1};
 const resized=resizeVisualTransform(initial,'se',180,320,360,640);
 expect(resized.x).toBeGreaterThan(1);expect(resized.y).toBeGreaterThan(1);
});
