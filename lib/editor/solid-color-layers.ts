import type { CompositionClock, CompositionClockHost } from './composition-clock';
import { cssMotionBlur } from './camera-motion-blur';
import { motionAt, NEUTRAL_MOTION, solidColorSettings, visibleMotion } from './clip-effects';
import { trackOf, type Clip } from './types';

export type SolidColorSource = { clip:Clip; index:number };
export const solidColorSources = (clips:Clip[]):SolidColorSource[] => clips.flatMap((clip,index)=>clip.kind==='solid'?[{clip,index}]:[]);
export type SolidColorController = {setSources(sources:SolidColorSource[]):void;preview(id:string,patch:Partial<Clip>|null):boolean;dispose():void};

/** Standalone V layers use the same clock and rectangle recipe in preview and export. */
export function installSolidColorLayers(initial:SolidColorSource[]):SolidColorController {
  const host=window as unknown as CompositionClockHost&{__revlineSolidColorController?:SolidColorController};
  const clock=host.__timelines.revline.__hfReal??host.__timelines.revline,composition=document.getElementById('composition')!;
  const entries=new Map<string,{clip:Clip;index:number;node:HTMLElement}>(),drafts=new Map<string,Partial<Clip>>();
  let signature='',disposed=false;
  function paint(){
    if(disposed)return;
    const time=clock.time(),width=Number(composition.dataset.width),height=Number(composition.dataset.height);
    for(const [id,entry] of entries){
      const clip={...entry.clip,...drafts.get(id)},settings=solidColorSettings(clip),keys=visibleMotion(clip);
      const motion=keys.length?motionAt(keys,Math.max(0,time-clip.start)):NEUTRAL_MOTION;
      entry.node.style.visibility=time>=clip.start&&time<clip.start+clip.duration?'visible':'hidden';
      entry.node.style.zIndex=String(trackOf(clip)*256+entry.index);entry.node.style.mixBlendMode=clip.blendMode??'normal';
      const rectangle=entry.node.firstElementChild as HTMLElement;
      // The playback runtime can resynchronize the outer clip's visibility
      // after a seek. Keep the actual paint on the shared composition clock,
      // just like the rectangles inside adjustment layers.
      rectangle.style.visibility=entry.node.style.visibility;
      rectangle.style.backgroundColor=settings.color;
      rectangle.style.left=`${settings.x*100}%`;rectangle.style.top=`${settings.y*100}%`;
      rectangle.style.width=`${settings.width*100}%`;rectangle.style.height=`${settings.height*100}%`;
      rectangle.style.opacity=String(settings.opacity*motion.opacity);
      const blur=keys.length?cssMotionBlur(keys,Math.max(0,time-clip.start),clip.motionBlur,width,height):0;
      rectangle.style.filter=`brightness(${motion.brightness})${blur>.05?` blur(${blur.toFixed(2)}px)`:''}`;
      rectangle.style.transform=`translate(-50%,-50%) translate(${motion.x*width}px,${motion.y*height}px) rotate(${motion.rotation}deg) scale(${motion.scale})`;
    }
  }
  function setSources(sources:SolidColorSource[]){
    const next=JSON.stringify(sources);
    if(next!==signature){
      signature=next;const wanted=new Set(sources.map(source=>source.clip.id));
      for(const [id,entry] of entries)if(!wanted.has(id)){entry.node.remove();entries.delete(id);drafts.delete(id);}
      for(const {clip,index} of sources){
        let entry=entries.get(clip.id);
        if(!entry){
          let node=Array.from(composition.querySelectorAll<HTMLElement>('[data-solid-color-clip]')).find(node=>node.dataset.solidColorClip===clip.id);
          if(!node){node=document.createElement('div');node.className='solid-color-layer';node.dataset.solidColorClip=clip.id;const rectangle=document.createElement('div');rectangle.className='solid-color-rectangle';node.appendChild(rectangle);composition.appendChild(node);}
          entry={clip,index,node};entries.set(clip.id,entry);
        }
        entry.clip=clip;entry.index=index;drafts.delete(clip.id);
      }
    }
    // FX hierarchy changes can replace the inner wrapper while a solid survives.
    const parent=Array.from(composition.querySelectorAll<HTMLElement>('.adjustment-layer')).find(node=>!node.querySelector('.adjustment-layer'))??composition;
    for(const {node} of entries.values())if(node.parentElement!==parent)parent.appendChild(node);
    paint();
  }
  const originalRender=clock.render,originalUpdate=clock.eventCallback('onUpdate') as (()=>void)|null;
  const render:CompositionClock['render']=function(...args){const result=originalRender.apply(clock,args);paint();return result;};
  const update=()=>{originalUpdate?.();paint();};clock.render=render;clock.eventCallback('onUpdate',update);
  const controller:SolidColorController={setSources,preview:(id,patch)=>{if(!entries.has(id))return false;if(patch)drafts.set(id,patch);else drafts.delete(id);paint();return true;},dispose:()=>{disposed=true;if(clock.render===render)clock.render=originalRender;if(clock.eventCallback('onUpdate')===update)clock.eventCallback('onUpdate',originalUpdate??undefined);}};
  host.__revlineSolidColorController=controller;setSources(initial);window.addEventListener('pagehide',controller.dispose,{once:true});return controller;
}
