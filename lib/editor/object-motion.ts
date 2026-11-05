import { isMotionEasing, sampleMotionAnchors, type MotionEasing, type MotionKeyframe } from './motion-path';
import { shiftEffectKeyframes } from './effect-keyframes';
import { validateClipEffects } from './clip-effects';
import { DEFAULT_TRANSFORM, dimensions, type AspectRatio, type Clip, type Timeline } from './types';

export type ObjectMotionAnchor = MotionKeyframe & {easing?:MotionEasing};
export type ObjectMotionCommand = {clipId:string;keyframes:ObjectMotionAnchor[];replaceMotion?:boolean};

/** Coordinate multiple independently editable words/objects in one atomic edit. */
export function animateObjects(timeline:Timeline,commands:ObjectMotionCommand[]):Timeline {
  if(!commands.length||commands.length>32||new Set(commands.map(command=>command.clipId)).size!==commands.length)throw new Error('Choose between one and 32 distinct objects.');
  const patches=new Map(commands.map(command=>{
    const clip=timeline.clips.find(clip=>clip.id===command.clipId);
    if(!clip)throw new Error('An animation object was not found.');
    return [clip.id,objectMotionPatch(clip,command.keyframes,{replaceMotion:command.replaceMotion,aspectRatio:timeline.aspectRatio})] as const;
  }));
  return {...timeline,clips:timeline.clips.map(clip=>patches.has(clip.id)?{...clip,...patches.get(clip.id)}:clip)};
}

/** Canvas-relative object animation shares camera easing without sharing its hierarchy. */
export function objectMotionPatch(clip:Clip,keyframes:ObjectMotionAnchor[],options:{replaceMotion?:boolean;aspectRatio?:AspectRatio}={}):Partial<Clip>{
  if(!['caption','graphic','image','video','solid'].includes(clip.kind))throw new Error('Animate a video, image, text or solid-color clip.');
  if((clip.cameraMotion||clip.smoothZoom)&&!options.replaceMotion)throw new Error('This clip has a camera animation. Explicitly authorize replacing its motion before animating it as an object.');
  for(const point of keyframes){
    if(!Number.isFinite(point.time)||point.time<0||point.time>clip.duration+1e-6)throw new Error('Object keyframes must fit inside this clip in clip-local timeline seconds.');
    if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||Math.abs(point.x)>1||Math.abs(point.y)>1)throw new Error('Object x/y offsets must use canvas fractions between -1 and 1.');
    if(point.easing!==undefined&&!isMotionEasing(point.easing))throw new Error('Choose a supported easing, or a cubic-bézier [x1, y1, x2, y2] with x1/x2 in 0..1.');
  }
  const eased=keyframes.some(point=>point.easing!==undefined&&point.easing!=='linear');
  if(eased&&(keyframes.length<2||keyframes.length>8))throw new Error('Use between two and eight anchors for an eased object path.');
  let anchors=keyframes;
  // Video and images nest motion inside their static placement the same way.
  if(clip.kind==='image'||clip.kind==='video'){
    const transform={...DEFAULT_TRANSFORM,...clip.transform};
    if(!Number.isFinite(transform.scale)||transform.scale<=0||!Number.isFinite(transform.rotation))throw new Error('The clip needs a valid static transform before animating it.');
    if(transform.rotation!==0&&!options.aspectRatio)throw new Error('The canvas aspect ratio is required to map rotated clip movement.');
    const canvas=dimensions(options.aspectRatio??'landscape'),angle=transform.rotation*Math.PI/180;
    // Image motion is nested inside its static placement. Undo the parent's
    // rotation and scale so requested canvas movement stays the requested size.
    anchors=keyframes.map(point=>({...point,
      x:(point.x*Math.cos(angle)+point.y*canvas.height/canvas.width*Math.sin(angle))/transform.scale,
      y:(-point.x*canvas.width/canvas.height*Math.sin(angle)+point.y*Math.cos(angle))/transform.scale,
    }));
  }
  const motion=eased?sampleMotionAnchors(anchors.map(point=>({...point,easing:point.easing??'linear'})),clip.duration):anchors.map(({easing:_easing,...point})=>({...point}));
  // The new path starts at offset 0; keep keyframed effects on the same clock.
  const patch:Partial<Clip>={pixelTracking:undefined,motion,motionOffset:0,cameraMotion:undefined,smoothZoom:undefined,...(clip.effectKeyframes?.length&&clip.motionOffset?{effectKeyframes:shiftEffectKeyframes(clip.effectKeyframes,-clip.motionOffset)}:{}),...(clip.kind==='caption'||clip.kind==='graphic'?{animation:'none' as const}:{} )};
  validateClipEffects({...clip,...patch});
  return patch;
}
