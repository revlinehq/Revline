import type { Clip } from './types';
import type { VisualCorner, VisualSnapLine } from './visual-transforms';

export type TextPlacement = { x: number; y: number; fontSize: number };
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
export function textPlacement(clip:Clip):TextPlacement {
  return {x:clip.x??.5,y:clip.y??(clip.kind==='caption'?.82:.5),fontSize:clip.fontSize??(clip.kind==='caption'?52:92)};
}
export function moveText(initial:TextPlacement,dx:number,dy:number,width:number,height:number,snap=true):TextPlacement {
  let x=clamp(initial.x+dx/width,0,1),y=clamp(initial.y+dy/height,0,1);
  if(snap&&Math.abs(x-.5)*width<=6)x=.5;
  if(snap&&Math.abs(y-.5)*height<=6)y=.5;
  return {...initial,x,y};
}
/** Align the painted text rectangle, including its edges, within a screen-pixel reach. */
export function snapTextMove(proposed:TextPlacement,bounds:{width:number;height:number},canvas:{width:number;height:number},threshold=6){
  const placement={...proposed},lines:VisualSnapLine[]=[];
  for(const axis of ['x','y'] as const){
    const size=axis==='x'?canvas.width:canvas.height,boxSize=axis==='x'?bounds.width:bounds.height;
    if(size<=0)continue;
    const center=proposed[axis]*size;
    let best:{delta:number;distance:number;position:number}|undefined;
    for(const target of [size/2,0,size])for(const value of [center,center-boxSize/2,center+boxSize/2]){
      const delta=target-value,distance=Math.abs(delta),next=proposed[axis]+delta/size;
      if(distance<=threshold&&next>=0&&next<=1&&(!best||distance<best.distance))best={delta,distance,position:target};
    }
    if(best){placement[axis]+=best.delta/size;lines.push({axis,position:best.position});}
  }
  return {placement,lines};
}
/** Resize from the opposite corner, using screen bounds and source font units. */
export function resizeText(initial:TextPlacement,corner:VisualCorner,dx:number,dy:number,boxWidth:number,boxHeight:number,canvasWidth:number,canvasHeight:number):TextPlacement {
  const sx=corner.endsWith('e')?1:-1,sy=corner.startsWith('s')?1:-1;
  const factor=1+(dx*sx*boxWidth+dy*sy*boxHeight)/(boxWidth*boxWidth+boxHeight*boxHeight);
  const fontSize=clamp(initial.fontSize*factor,8,300),scale=fontSize/initial.fontSize;
  return {fontSize,x:clamp(initial.x+sx*boxWidth*(scale-1)/2/canvasWidth,0,1),y:clamp(initial.y+sy*boxHeight*(scale-1)/2/canvasHeight,0,1)};
}
