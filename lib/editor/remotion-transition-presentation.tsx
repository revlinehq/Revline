import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { TransitionPresentation } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { transitionWipeSettings, type TransitionDirection, type TransitionPreset, type TransitionWipeSettings } from './clip-transitions';

export type RemotionTransitionPresentationProps = {
  preset: TransitionPreset; direction: TransitionDirection; progress: number; durationInFrames: number; outputHeight?: number;
  from: ReactNode; to: ReactNode;
} & Partial<TransitionWipeSettings>;
const fill: CSSProperties = { position:'absolute',inset:0,width:'100%',height:'100%' };
const ignore = () => {};
// Add weighted premultiplied scenes inside a transparent isolated group. Source-over
// fades lose opacity at the midpoint and leave outgoing pixels behind transparent media.
function presentation(preset:TransitionPreset,direction:TransitionDirection,progress:number,outputHeight:number,settings:TransitionWipeSettings){
  const enterStyle:CSSProperties={mixBlendMode:'plus-lighter'},exitStyle:CSSProperties={mixBlendMode:'plus-lighter'};
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
  }else if(preset==='whip-pan'){
    // Both shots travel together like one fast pan; blur peaks mid-move, as a real whip smears.
    const eased=progress<.5?4*progress**3:1-(-2*progress+2)**3/2,horizontal=settings.wipeDirection==='left'||settings.wipeDirection==='right',sign=settings.wipeDirection==='right'||settings.wipeDirection==='down'?1:-1;
    const axis=horizontal?'translateX':'translateY',blur=Math.sin(Math.PI*progress)*28*outputHeight/1080;
    exitStyle.transform=`${axis}(${sign*eased*100}%)`;enterStyle.transform=`${axis}(${sign*(eased-1)*100}%)`;
    exitStyle.filter=enterStyle.filter=`blur(${blur.toFixed(2)}px)`;
    exitStyle.opacity=progress===1?0:1;enterStyle.opacity=progress===0?0:1;
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
  // Use the public styles of the actual Remotion fade presentation. Shader
  // presentations require new HTML-in-canvas capture rather than retained media DOM.
  return fade({shouldFadeOutExitingScene:true,enterStyle,exitStyle});
}

function Pair<P extends Record<string,unknown>>({ presentation, progress, durationInFrames, from, to }: Omit<RemotionTransitionPresentationProps,'preset'|'direction'> & {presentation:TransitionPresentation<P>}) {
  const Component=presentation.component;
  const common={presentationProgress:progress,presentationDurationInFrames:durationInFrames,passedProps:presentation.props,onElementImage:ignore,onUnmount:ignore,bothEnteringAndExiting:false};
  return <><Component {...common} presentationDirection="exiting">{from}</Component><Component {...common} presentationDirection="entering">{to}</Component></>;
}

/** Genuine Remotion presentations; the existing editor/export clock supplies progress. */
function RemotionTransitionPresentation({preset,direction,progress,durationInFrames,outputHeight=1080,from,to,...settings}:RemotionTransitionPresentationProps){
  if(!Number.isFinite(progress)||!Number.isFinite(durationInFrames)||durationInFrames<1||!Number.isFinite(outputHeight)||outputHeight<=0)throw new Error('Transition presentation needs finite progress and positive frame duration/output height.');
  const bounded=Math.max(0,Math.min(1,progress));
  const pair={progress:bounded,durationInFrames,from,to};
  return <div data-remotion-transition={preset} data-progress={bounded} style={{...fill,overflow:'hidden',isolation:'isolate',pointerEvents:'none'}}>
    <Pair {...pair} presentation={presentation(preset,direction,bounded,outputHeight,transitionWipeSettings(settings))}/>
  </div>;
}

function moveSlot(parent:HTMLElement,slot:HTMLElement){
  if(slot.parentElement===parent)return;
  // Connected moveBefore preserves media/iframe state in browsers that support it.
  const target=parent as HTMLElement&{moveBefore?:(node:Node,reference:Node|null)=>void};
  if(typeof target.moveBefore==='function'&&parent.isConnected&&slot.isConnected)target.moveBefore(slot,null);
  else parent.appendChild(slot);
}
function Slot({node}:{node:HTMLElement}){
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{moveSlot(ref.current!,node)},[node]);
  return <div ref={ref} style={fill}/>;
}
export type PresentationFrame = Omit<RemotionTransitionPresentationProps,'from'|'to'>;
export type PresentationBridge = {fromSlot:HTMLElement;toSlot:HTMLElement;render:(frame:PresentationFrame)=>void;dispose:()=>void};

/** Adopt retained DOM into stable slots. Decoding, sampling and the host itself belong to the controller. */
export function createPresentation(host:HTMLElement):PresentationBridge{
  const rootHost=host.ownerDocument.createElement('div'),reserve=host.ownerDocument.createElement('div');
  Object.assign(rootHost.style,fill);reserve.hidden=true;
  const fromSlot=host.ownerDocument.createElement('div'),toSlot=host.ownerDocument.createElement('div');
  Object.assign(fromSlot.style,fill);Object.assign(toSlot.style,fill);
  fromSlot.dataset.transitionSlot='from';toSlot.dataset.transitionSlot='to';
  reserve.appendChild(fromSlot);reserve.appendChild(toSlot);host.appendChild(rootHost);host.appendChild(reserve);
  const root=createRoot(rootHost),from=<Slot node={fromSlot}/>,to=<Slot node={toSlot}/>;
  let previous:PresentationFrame|undefined,disposed=false;
  const rescue=()=>{moveSlot(reserve,fromSlot);moveSlot(reserve,toSlot)};
  return {fromSlot,toSlot,
    render(frame){
      if(disposed)throw new Error('This transition presentation is disposed.');
      if(previous&&Object.keys(frame).every(key=>frame[key as keyof PresentationFrame]===previous![key as keyof PresentationFrame]))return;
      // All presets retain the same native Remotion component/carriers as styles change.
      flushSync(()=>root.render(<RemotionTransitionPresentation {...frame} from={from} to={to}/>));
      previous={...frame};
    },
    dispose(){
      if(disposed)return;
      rescue();flushSync(()=>root.unmount());rootHost.remove();disposed=true;
      // Keep unmanaged slots connected. The controller restores retained scenes before removing its host.
    },
  };
}
