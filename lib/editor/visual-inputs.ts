import {DEFAULT_CROP,DEFAULT_TRANSFORM,type Clip,type SourceCrop,type VisualTransform} from './types';

export const VISUAL_INPUT_UNITS=['normalized','pixels'] as const;
export type VisualInputUnits=typeof VISUAL_INPUT_UNITS[number];
export const VISUAL_CANVAS_REFERENCE=1080;
export const VISUAL_TRANSFORM_LIMITS={x:[0,1],y:[0,1],scale:[.1,5],rotation:[-360,360],opacity:[0,1]} as const;
export const MAX_SOURCE_CROP=.95;
type Size={width?:number;height?:number};
const defined=<T extends object>(input:T)=>Object.fromEntries(Object.entries(input).filter(([,value])=>value!==undefined)) as T;
function dimensionsKnown(size:Size){
  if(![size.width,size.height].every(value=>typeof value==='number'&&Number.isFinite(value)&&value>0))throw new Error('Known positive width and height are required for pixel inputs.');
  return {width:size.width!,height:size.height!};
}
function mediaOnly(clip:Clip){if(clip.kind!=='video'&&clip.kind!=='image')throw new Error('Choose a video or image.');}

/** Pixel centers use the editor's canvas reference; scale/degrees/opacity retain their usual units. */
export function transformInputPatch(clip:Clip,changes:Partial<VisualTransform>,canvas:Size,units:VisualInputUnits='normalized'):Pick<Clip,'transform'>{
  mediaOnly(clip);
  if(!Object.values(changes).some(value=>value!==undefined))throw new Error('Specify a transform change.');
  const patch=defined(changes);
  if(units==='pixels'){
    const {width,height}=dimensionsKnown(canvas);
    if(patch.x!==undefined)patch.x/=width;
    if(patch.y!==undefined)patch.y/=height;
  }
  const transform={...DEFAULT_TRANSFORM,...clip.transform,...patch};
  const bounds=VISUAL_TRANSFORM_LIMITS;
  for(const key of Object.keys(bounds) as (keyof VisualTransform)[]){const[min,max]=bounds[key];if(!Number.isFinite(transform[key])||transform[key]<min||transform[key]>max)throw new Error(`Transform ${key} is outside its supported range.`);}
  return {transform};
}

/** Intrinsic-source crop pixels become a mask; placement, fitted source size and timing stay intact. */
export function cropInputPatch(clip:Clip,changes:Partial<SourceCrop>,source:Size,units:VisualInputUnits='normalized'):Pick<Clip,'crop'>{
  mediaOnly(clip);
  if(!Object.values(changes).some(value=>value!==undefined))throw new Error('Specify a crop edge.');
  const patch=defined(changes);
  if(units==='pixels'){
    const {width,height}=dimensionsKnown(source);
    for(const edge of ['left','right'] as const)if(patch[edge]!==undefined)patch[edge]/=width;
    for(const edge of ['top','bottom'] as const)if(patch[edge]!==undefined)patch[edge]/=height;
  }
  const crop={...DEFAULT_CROP,...clip.crop,...patch};
  if(Object.values(crop).some(value=>!Number.isFinite(value)||value<0)||crop.left+crop.right>=MAX_SOURCE_CROP||crop.top+crop.bottom>=MAX_SOURCE_CROP)throw new Error('Crop edges must leave more than 5% of each source axis.');
  return {crop};
}
