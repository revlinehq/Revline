import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { TransitionPresentation } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import type { TransitionDirection, TransitionPreset } from './clip-transitions';

export type RemotionTransitionPresentationProps = {
  preset: TransitionPreset; direction: TransitionDirection; progress: number; durationInFrames: number; outputHeight?: number;
  from: ReactNode; to: ReactNode;
};
const fill: CSSProperties = { position:'absolute',inset:0,width:'100%',height:'100%' };
const ignore = () => {};
// Add weighted premultiplied scenes inside a transparent isolated group. Source-over
// fades lose opacity at the midpoint and leave outgoing pixels behind transparent media.
function presentation(preset:TransitionPreset,direction:TransitionDirection,progress:number,outputHeight:number){
  const enterStyle:CSSProperties={mixBlendMode:'plus-lighter'},exitStyle:CSSProperties={mixBlendMode:'plus-lighter'};
  if(preset==='spin-zoom'){
    const sign=direction==='counter-clockwise'?-1:1;
    exitStyle.transform=`rotate(${sign*18*progress}deg) scale(${1+.55*progress})`;
    enterStyle.transform=`rotate(${-sign*18*(1-progress)}deg) scale(${1+.55*(1-progress)})`;
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
export function RemotionTransitionPresentation({preset,direction,progress,durationInFrames,outputHeight=1080,from,to}:RemotionTransitionPresentationProps){
  if(!Number.isFinite(progress)||!Number.isFinite(durationInFrames)||durationInFrames<1||!Number.isFinite(outputHeight)||outputHeight<=0)throw new Error('Transition presentation needs finite progress and positive frame duration/output height.');
  const bounded=Math.max(0,Math.min(1,progress));
  const pair={progress:bounded,durationInFrames,from,to};
  return <div data-remotion-transition={preset} data-progress={bounded} style={{...fill,overflow:'hidden',isolation:'isolate',pointerEvents:'none'}}>
    <Pair {...pair} presentation={presentation(preset,direction,bounded,outputHeight)}/>
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
