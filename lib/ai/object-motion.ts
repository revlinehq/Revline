import { sampleMotionAnchors } from '../editor/motion-path';
import { validateClipEffects, type MotionKeyframe } from '../editor/clip-effects';
import { SMOOTH_ZOOM_EASINGS, type SmoothZoomSettings } from '../editor/smooth-zoom-settings';
import { DEFAULT_TRANSFORM, dimensions, type AspectRatio, type Clip } from '../editor/types';

export type ObjectMotionAnchor = MotionKeyframe & {easing?:SmoothZoomSettings['easing']};

/** Canvas-relative object animation shares camera easing without sharing its hierarchy. */
export function objectMotionPatch(clip:Clip,keyframes:ObjectMotionAnchor[],options:{replaceMotion?:boolean;aspectRatio?:AspectRatio}={}):Partial<Clip>{
  if(!['caption','graphic','image','solid'].includes(clip.kind))throw new Error('Animate a text, uploaded image or solid-color object. Uploaded video camera motion uses the camera tools.');
  if((clip.cameraMotion||clip.smoothZoom)&&!options.replaceMotion)throw new Error('This image has a camera animation. Explicitly authorize replacing its motion before animating it as an object.');
  if(keyframes.length>120)throw new Error('Use at most 120 linear object keyframes.');
  for(const point of keyframes){
    if(!Number.isFinite(point.time)||point.time<0||point.time>clip.duration+1e-6)throw new Error('Object keyframes must fit inside this clip in clip-local timeline seconds.');
    if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||Math.abs(point.x)>1||Math.abs(point.y)>1)throw new Error('Object x/y offsets must use canvas fractions between -1 and 1.');
    if(point.easing!==undefined&&!SMOOTH_ZOOM_EASINGS.includes(point.easing))throw new Error('Choose a supported object easing.');
  }
  const eased=keyframes.some(point=>point.easing!==undefined&&point.easing!=='linear');
  if(eased&&(keyframes.length<2||keyframes.length>8))throw new Error('Use between two and eight anchors for an eased object path.');
  let anchors=keyframes;
  if(clip.kind==='image'){
    const transform={...DEFAULT_TRANSFORM,...clip.transform};
    if(!Number.isFinite(transform.scale)||transform.scale<=0||!Number.isFinite(transform.rotation))throw new Error('The image needs a valid static transform before animating it.');
    if(transform.rotation!==0&&!options.aspectRatio)throw new Error('The canvas aspect ratio is required to map rotated image movement.');
    const canvas=dimensions(options.aspectRatio??'landscape'),angle=transform.rotation*Math.PI/180;
    // Image motion is nested inside its static placement. Undo the parent's
    // rotation and scale so requested canvas movement stays the requested size.
    anchors=keyframes.map(point=>({...point,
      x:(point.x*Math.cos(angle)+point.y*canvas.height/canvas.width*Math.sin(angle))/transform.scale,
      y:(-point.x*canvas.width/canvas.height*Math.sin(angle)+point.y*Math.cos(angle))/transform.scale,
    }));
  }
  const motion=eased?sampleMotionAnchors(anchors.map(point=>({...point,easing:point.easing??'linear'})),clip.duration):anchors.map(({easing:_easing,...point})=>({...point}));
  const patch:Partial<Clip>={motion,motionOffset:0,cameraMotion:undefined,smoothZoom:undefined,...(clip.kind==='caption'||clip.kind==='graphic'?{animation:'none' as const}:{} )};
  validateClipEffects({...clip,...patch});
  return patch;
}
