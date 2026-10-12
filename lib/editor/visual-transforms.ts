import { DEFAULT_TRANSFORM, type SourceCrop, type VisualTransform } from './types';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export type VisualCorner = 'nw' | 'ne' | 'sw' | 'se';
export type VisualRect = { left: number; top: number; width: number; height: number };
export type VisualBounds = { cx: number; cy: number; width: number; height: number; rotation: number };
export type VisualSnapLine = { axis: 'x' | 'y'; position: number };
export type VisualSnapResult = { transform: VisualTransform; lines: VisualSnapLine[] };
type Size = { width: number; height: number };

// Adapted from OpenCut preview/element-bounds.ts and components/handle-primitives.tsx,
// revision cf5e79e919144200294fb9fed22a222592a0aeea. MIT: third-party/OpenCut-LICENSE.
export function visualBounds(transform: VisualTransform, rect: VisualRect, width: number, height: number): VisualBounds {
  const localX = (rect.left + rect.width / 2 - width / 2) * transform.scale;
  const localY = (rect.top + rect.height / 2 - height / 2) * transform.scale;
  const angle = transform.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  return { cx: transform.x * width + localX * cos - localY * sin, cy: transform.y * height + localX * sin + localY * cos,
    width: rect.width * transform.scale, height: rect.height * transform.scale, rotation: transform.rotation };
}

export function visualCornerPosition(bounds: VisualBounds, corner: VisualCorner) {
  const localX = (corner.endsWith('e') ? 1 : -1) * bounds.width / 2;
  const localY = (corner.startsWith('s') ? 1 : -1) * bounds.height / 2;
  const angle = bounds.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: bounds.cx + localX * cos - localY * sin, y: bounds.cy + localX * sin + localY * cos };
}

export function visualResizeCursor(angleDeg: number) {
  const normalized = ((angleDeg % 180) + 180) % 180;
  if (normalized < 22.5 || normalized >= 157.5) return 'ew-resize';
  if (normalized < 67.5) return 'nwse-resize';
  if (normalized < 112.5) return 'ns-resize';
  return 'nesw-resize';
}

export function cropToAspect(width: number, height: number, aspect: number): SourceCrop {
  if (![width,height,aspect].every(value => Number.isFinite(value) && value > 0)) throw new Error('Source dimensions are needed to crop this media.');
  const sourceAspect = width / height;
  const removed = sourceAspect > aspect ? 1 - aspect / sourceAspect : 1 - sourceAspect / aspect;
  if (removed >= .95) throw new Error('This crop would leave less than 5% of the source.');
  return sourceAspect > aspect ? {left:removed/2,right:removed/2,top:0,bottom:0} : {left:0,right:0,top:removed/2,bottom:removed/2};
}

export function moveVisualTransform(initial: VisualTransform, dx: number, dy: number, width: number, height: number): VisualTransform {
  return {...initial,x:clamp(initial.x+dx/width,0,1),y:clamp(initial.y+dy/height,0,1)};
}

function axisPositions(bounds: VisualBounds) {
  const angle=bounds.rotation*Math.PI/180,cos=Math.abs(Math.cos(angle)),sin=Math.abs(Math.sin(angle));
  const halfWidth=(bounds.width*cos+bounds.height*sin)/2,halfHeight=(bounds.width*sin+bounds.height*cos)/2;
  return {x:[bounds.cx,bounds.cx-halfWidth,bounds.cx+halfWidth],y:[bounds.cy,bounds.cy-halfHeight,bounds.cy+halfHeight]};
}

// OpenCut preview-snap.ts's rotated bounds / nearest-axis targets, adapted to
// Revline's normalized transforms and retained crop rectangle. Same MIT notice above.
export function snapVisualMove(proposed: VisualTransform, rect: VisualRect, canvas: Size, viewport: Size, threshold=8): VisualSnapResult {
  const positions=axisPositions(visualBounds(proposed,rect,canvas.width,canvas.height));
  const transform={...proposed},lines:VisualSnapLine[]=[];
  for(const axis of ['x','y'] as const){
    const size=axis==='x'?canvas.width:canvas.height,screen=axis==='x'?viewport.width:viewport.height;
    if(size<=0||screen<=0)continue;
    let best:{delta:number;distance:number;position:number}|undefined;
    for(const target of [size/2,0,size])for(const value of positions[axis]){
      const delta=target-value,distance=Math.abs(delta)*screen/size,next=proposed[axis]+delta/size;
      if(distance<=threshold&&next>=0&&next<=1&&(!best||distance<best.distance))best={delta,distance,position:target};
    }
    if(best){transform[axis]+=best.delta/size;lines.push({axis,position:best.position});}
  }
  return {transform,lines};
}

function anchoredScale(initial:VisualTransform,corner:VisualCorner,scale:number,width:number,height:number,rect:VisualRect):VisualTransform {
  const sx=corner.endsWith('e')?1:-1,sy=corner.startsWith('s')?1:-1;
  const radians=initial.rotation*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians);
  const oppositeX=rect.left+rect.width/2-width/2-sx*rect.width/2;
  const oppositeY=rect.top+rect.height/2-height/2-sy*rect.height/2;
  const deltaScale=initial.scale-scale;
  return {...initial,scale,x:initial.x+(oppositeX*cos-oppositeY*sin)*deltaScale/width,y:initial.y+(oppositeX*sin+oppositeY*cos)*deltaScale/height};
}

/** The opposite corner stays anchored, including on a rotated canvas layer. */
export function resizeVisualTransform(initial: VisualTransform, corner: VisualCorner, dx: number, dy: number, width: number, height: number, rect: VisualRect = {left:0,top:0,width,height}): VisualTransform {
  const sx=corner.endsWith('e')?1:-1, sy=corner.startsWith('s')?1:-1;
  const radians=initial.rotation*Math.PI/180, cos=Math.cos(radians), sin=Math.sin(radians);
  const vx=sx*rect.width*cos-sy*rect.height*sin, vy=sx*rect.width*sin+sy*rect.height*cos;
  const delta=(dx*vx+dy*vy)/(rect.width*rect.width+rect.height*rect.height);
  const scale=clamp(initial.scale+delta,.1,5);
  const next=anchoredScale(initial,corner,scale,width,height,rect);
  return {...next,x:clamp(next.x,0,1),y:clamp(next.y,0,1)};
}

/** Scale magnets keep the opposite content corner fixed and the aspect ratio intact. */
export function snapVisualResize(initial:VisualTransform,proposed:VisualTransform,corner:VisualCorner,rect:VisualRect,canvas:Size,viewport:Size,threshold=8):VisualSnapResult {
  if(canvas.width<=0||canvas.height<=0||viewport.width<=0||viewport.height<=0)return {transform:proposed,lines:[]};
  const positions=axisPositions(visualBounds(proposed,rect,canvas.width,canvas.height));
  const atScale=(scale:number)=>anchoredScale(initial,corner,scale,canvas.width,canvas.height,rect);
  const zero=axisPositions(visualBounds(atScale(0),rect,canvas.width,canvas.height));
  const one=axisPositions(visualBounds(atScale(1),rect,canvas.width,canvas.height));
  const currentCorner=visualCornerPosition(visualBounds(proposed,rect,canvas.width,canvas.height),corner);
  let best:{transform:VisualTransform;distance:number}|undefined;
  for(const axis of ['x','y'] as const){
    const size=axis==='x'?canvas.width:canvas.height,screen=axis==='x'?viewport.width:viewport.height;
    for(const target of [size/2,0,size])for(let index=0;index<positions[axis].length;index++){
      const slope=one[axis][index]-zero[axis][index];
      if(Math.abs(slope)<1e-8||Math.abs(target-positions[axis][index])*screen/size>threshold)continue;
      const scale=(target-zero[axis][index])/slope;
      if(scale<.1||scale>5)continue;
      const transform=atScale(scale);
      if(transform.x<0||transform.x>1||transform.y<0||transform.y>1)continue;
      const cornerPoint=visualCornerPosition(visualBounds(transform,rect,canvas.width,canvas.height),corner);
      const distance=Math.hypot((cornerPoint.x-currentCorner.x)*viewport.width/canvas.width,(cornerPoint.y-currentCorner.y)*viewport.height/canvas.height);
      if(distance<=threshold&&(!best||distance<best.distance))best={transform,distance};
    }
  }
  if(!best)return {transform:proposed,lines:[]};
  const snapped=axisPositions(visualBounds(best.transform,rect,canvas.width,canvas.height)),lines:VisualSnapLine[]=[];
  for(const axis of ['x','y'] as const){
    const size=axis==='x'?canvas.width:canvas.height,screen=axis==='x'?viewport.width:viewport.height;
    for(const target of [size/2,0,size])if(snapped[axis].some((value,index)=>Math.abs(one[axis][index]-zero[axis][index])>1e-8&&Math.abs(value-target)*screen/size<.5))lines.push({axis,position:target});
  }
  return {transform:best.transform,lines};
}
export function visualTransform(value?: VisualTransform): VisualTransform {return {...DEFAULT_TRANSFORM,...value};}

export function sameVisualTransform(first:VisualTransform,second:VisualTransform):boolean {
  return first.x===second.x&&first.y===second.y&&first.scale===second.scale&&first.rotation===second.rotation&&first.opacity===second.opacity;
}
