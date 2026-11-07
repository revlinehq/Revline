// Transition presentations: two full-size layers (outgoing, then incoming) styled per frame with CSS transforms,
// filters, masks and opacity. No React and no Remotion; HyperFrames owns the clock, playback, audio and export.
import { transitionWipeSettings } from './clip-transitions';
import type { TransitionDirection, TransitionPreset, TransitionWipeSettings } from './types';
import { whipFrame, whipFrameLength, type WhipFrame, type WhipPlacement } from './whip';

type Style = Partial<Record<'opacity'|'transform'|'filter'|'mixBlendMode'|'zIndex'|'maskImage'|'maskRepeat', string|number>>;
export type PresentationFrame = { preset: TransitionPreset; direction: TransitionDirection; progress: number; durationInFrames: number; /** The transition's length in seconds; the cut is at its middle. */ duration: number; outputHeight?: number } & Partial<TransitionWipeSettings>;
const fill='position:absolute;inset:0;width:100%;height:100%';
// A full-size column layer, the box every shot is drawn in during a transition.
const layerBase=`${fill};display:flex;flex-direction:column`;
// Add weighted premultiplied scenes inside a transparent isolated group. Source-over
// fades lose opacity at the midpoint and leave outgoing pixels behind transparent media.
let whipFilters=0;
// Exponents of power4.in and of 1 − expo.out: the outgoing shot accelerates out, the incoming one settles.
/** The footage whip at this progress, from the same per-frame math as the film whip() (whip.ts). */
function footageWhip(progress:number,duration:number,durationInFrames:number,settings:TransitionWipeSettings){
  const fps=Math.round(durationInFrames/duration);
  return whipFrame({direction:settings.whipDirection,frames:Math.max(2,Math.round(duration/whipFrameLength(fps))),fps,travel:settings.travel,blur:settings.blur},(progress-.5)*duration);
}
function presentation(preset:TransitionPreset,direction:TransitionDirection,progress:number,outputHeight:number,settings:TransitionWipeSettings,whip:WhipFrame|undefined,filterId:string){
  const enterStyle:Style={mixBlendMode:'plus-lighter'},exitStyle:Style={mixBlendMode:'plus-lighter'};
  if(preset==='gradient-wipe'||preset==='iris-wipe'){
    // Matching complementary alpha ramps conserve the scenes' premultiplied colors.
    // Override fade opacity: the mask alone determines this presentation's weights.
    enterStyle.opacity=progress===0?0:1;exitStyle.opacity=progress===1?0:1;
    if(progress>0&&progress<1){
      const edge=progress*(1+settings.softness),inner=(edge-settings.softness)*100,outer=edge*100;
      const geometry=preset==='gradient-wipe'?`linear-gradient(to ${settings.wipeDirection==='up'?'top':settings.wipeDirection==='down'?'bottom':settings.wipeDirection},`:`radial-gradient(${settings.shape} farthest-corner at ${settings.centerX*100}% ${settings.centerY*100}%,`;
      enterStyle.maskImage=`${geometry}#000 ${inner}%,transparent ${outer}%)`;
      exitStyle.maskImage=`${geometry}transparent ${inner}%,#000 ${outer}%)`;
      enterStyle.maskRepeat=exitStyle.maskRepeat='no-repeat';
    }
  }else if(preset==='spin-zoom'){
    const sign=direction==='counter-clockwise'?-1:1;
    exitStyle.transform=`rotate(${sign*18*progress}deg) scale(${1+.55*progress})`;
    enterStyle.transform=`rotate(${-sign*18*(1-progress)}deg) scale(${1+.55*(1-progress)})`;
  }else if(preset==='whip-pan'&&settings.whipLegacy){
    // Whip-pans saved before whipDirection keep the look they were approved and exported with: a full-frame slide.
    const eased=progress<.5?4*progress**3:1-(-2*progress+2)**3/2,horizontal=settings.wipeDirection==='left'||settings.wipeDirection==='right',sign=settings.wipeDirection==='right'||settings.wipeDirection==='down'?1:-1;
    const axis=horizontal?'translateX':'translateY',blur=Math.sin(Math.PI*progress)*28*outputHeight/1080;
    exitStyle.transform=`${axis}(${sign*eased*100}%)`;enterStyle.transform=`${axis}(${sign*(eased-1)*100}%)`;
    exitStyle.filter=enterStyle.filter=`blur(${blur.toFixed(2)}px)`;
    exitStyle.opacity=progress===1?0:1;enterStyle.opacity=progress===0?0:1;
  }else if(preset==='whip-pan'&&whip){
    // The shot in front flicks along the whip; the other one sits underneath at its own whip position, filling
    // the edge the front one uncovers. Both are blurred along the whip axis by the presentation's SVG filter.
    const zoom=settings.whipDirection==='zoom'||settings.whipDirection==='zoom-out',horizontal=settings.whipDirection==='left'||settings.whipDirection==='right';
    const place=(at:WhipPlacement)=>zoom?`scale(${at.scale})`:`${horizontal?'translateX':'translateY'}(${Math.round((horizontal?at.x:at.y)*1e6)/1e4}%)`;
    exitStyle.transform=place(whip.out);enterStyle.transform=place(whip.in);
    exitStyle.mixBlendMode=enterStyle.mixBlendMode='normal';
    exitStyle.zIndex=whip.front==='out'?1:0;enterStyle.zIndex=whip.front==='out'?0:1;
    exitStyle.filter=enterStyle.filter=`url(#${filterId})`;
    // Both shots stay opaque through the whip: the one underneath fills the edge from the first frame.
    exitStyle.opacity=enterStyle.opacity=1;
  }else if(preset==='zoom-through'){
    const blur=Math.sin(Math.PI*progress)*14*outputHeight/1080;
    exitStyle.transform=`scale(${1+3*progress**2.2})`;enterStyle.transform=`scale(${.35+.65*(1-(1-progress)**2.2)})`;
    exitStyle.filter=enterStyle.filter=`blur(${blur.toFixed(2)}px)`;
  }else if(preset==='film-burn'){
    // Burn toward warm overexposure at the cut, then develop the incoming shot back.
    const burn=(amount:number)=>`brightness(${(1+5*amount**1.4).toFixed(3)}) sepia(${(.7*amount).toFixed(3)}) saturate(${(1+2.2*amount).toFixed(3)}) hue-rotate(${(-12*amount).toFixed(2)}deg) contrast(${(1+.25*amount).toFixed(3)})`;
    exitStyle.filter=burn(Math.min(1,progress*1.6));enterStyle.filter=burn(Math.min(1,(1-progress)*1.6));
  }else if(preset==='blur-dissolve'){
    const blur=20*outputHeight/1080;
    exitStyle.filter=`blur(${blur*progress}px)`;
    enterStyle.filter=`blur(${blur*(1-progress)}px)`;
  }
  // Our crossfade underneath every preset: the outgoing shot fades out and the incoming one in, unless the
  // preset sets its own opacity.
  return {exit:{opacity:1-progress,...exitStyle},enter:{opacity:progress,...enterStyle}};
}

function moveSlot(parent:HTMLElement,slot:HTMLElement){
  if(slot.parentElement===parent)return;
  // Connected moveBefore preserves media/iframe state in browsers that support it.
  const target=parent as HTMLElement&{moveBefore?:(node:Node,reference:Node|null)=>void};
  if(typeof target.moveBefore==='function'&&parent.isConnected&&slot.isConnected)target.moveBefore(slot,null);
  else parent.appendChild(slot);
}
function applyStyle(layer:HTMLElement,style:Style){
  layer.style.cssText=layerBase;
  for(const [key,value] of Object.entries(style))if(value!==undefined)(layer.style as unknown as Record<string,string>)[key]=String(value);
}
export type PresentationBridge = {fromSlot:HTMLElement;toSlot:HTMLElement;render:(frame:PresentationFrame)=>void;dispose:()=>void};

/** Adopt retained DOM into stable slots. Decoding, sampling and the host itself belong to the controller. */
export function createPresentation(host:HTMLElement):PresentationBridge{
  const doc=host.ownerDocument,make=()=>{const node=doc.createElement('div');node.style.cssText=fill;return node;};
  const rootHost=make(),reserve=doc.createElement('div');reserve.hidden=true;
  const fromSlot=make(),toSlot=make();
  fromSlot.dataset.transitionSlot='from';toSlot.dataset.transitionSlot='to';
  reserve.appendChild(fromSlot);reserve.appendChild(toSlot);host.appendChild(rootHost);host.appendChild(reserve);
  // Built on the first render: a clipping group holding the whip blur filter, then the outgoing and incoming layers.
  const filterId=`revline-whip-pan-${++whipFilters}`,svgNs='http://www.w3.org/2000/svg';
  const group=doc.createElement('div'),svg=doc.createElementNS(svgNs,'svg'),filter=doc.createElementNS(svgNs,'filter'),gauss=doc.createElementNS(svgNs,'feGaussianBlur');
  svg.setAttribute('width','0');svg.setAttribute('height','0');svg.setAttribute('aria-hidden','true');svg.style.position='absolute';
  filter.id=filterId;filter.setAttribute('color-interpolation-filters','sRGB');filter.appendChild(gauss);svg.appendChild(filter);
  const exitLayer=doc.createElement('div'),enterLayer=doc.createElement('div'),exitBox=make(),enterBox=make();
  exitLayer.appendChild(exitBox);enterLayer.appendChild(enterBox);
  let previous:PresentationFrame|undefined,disposed=false,mounted=false;
  const rescue=()=>{moveSlot(reserve,fromSlot);moveSlot(reserve,toSlot)};
  return {fromSlot,toSlot,
    render(frame){
      if(disposed)throw new Error('This transition presentation is disposed.');
      if(previous&&Object.keys(frame).every(key=>frame[key as keyof PresentationFrame]===previous![key as keyof PresentationFrame]))return;
      const {preset,direction,progress,durationInFrames,duration,outputHeight=1080,...settings}=frame;
      if(!Number.isFinite(progress)||!Number.isFinite(durationInFrames)||durationInFrames<1||!Number.isFinite(duration)||duration<=0||!Number.isFinite(outputHeight)||outputHeight<=0)throw new Error('Transition presentation needs finite progress and positive frame duration/output height.');
      const bounded=Math.max(0,Math.min(1,progress)),resolved=transitionWipeSettings(settings);
      if(!mounted){
        group.style.cssText=`${fill};overflow:hidden;isolation:isolate;pointer-events:none`;
        group.appendChild(exitLayer);group.appendChild(enterLayer);rootHost.appendChild(group);mounted=true;
      }
      group.dataset.transition=preset;group.dataset.progress=String(bounded);
      const whipAt=preset==='whip-pan'&&!resolved.whipLegacy?footageWhip(bounded,duration,durationInFrames,resolved):undefined;
      if(whipAt){const {blur}=whipAt,k=outputHeight/1080;gauss.setAttribute('stdDeviation',`${(blur.x*k).toFixed(2)} ${(blur.y*k).toFixed(2)}`);if(svg.parentElement!==group)group.insertBefore(svg,group.firstChild);}
      else svg.remove();
      const styles=presentation(preset,direction,bounded,outputHeight,resolved,whipAt,filterId);
      applyStyle(exitLayer,styles.exit);applyStyle(enterLayer,styles.enter);
      moveSlot(exitBox,fromSlot);moveSlot(enterBox,toSlot);
      previous={...frame};
    },
    dispose(){
      if(disposed)return;
      rescue();rootHost.remove();disposed=true;
      // Keep unmanaged slots connected. The controller restores retained scenes before removing its host.
    },
  };
}
