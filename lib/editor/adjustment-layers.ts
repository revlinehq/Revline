import { cinematicBarSettings, motionAt, NEUTRAL_MOTION, solidColorSettings, visibleMotion } from './clip-effects';
import { trackOf, type Clip } from './types';

export type AdjustmentSource = { clip: Clip; index: number };
export const adjustmentSources = (clips: Clip[]): AdjustmentSource[] => clips.flatMap((clip,index) => clip.kind === 'effect' ? [{clip,index}] : []);

/** The same sampled motion drives a retained preview and fresh export. */
export function adjustmentFrame(clip: Clip, time: number) {
  const local = time-clip.start, keys = visibleMotion(clip);
  if (local < 0 || local >= clip.duration || !keys.length) return NEUTRAL_MOTION;
  if (clip.effectPreset !== 'cinematic-bars') return motionAt(keys,local);
  const after = keys.findIndex(key=>key.time>=local);
  if (after <= 0) return keys[Math.max(0,after)];
  const a=keys[after-1],b=keys[after],p=(local-a.time)/(b.time-a.time);
  const eased=p<.5 ? 4*p*p*p : 1-(-2*p+2)**3/2;
  return {...NEUTRAL_MOTION,opacity:a.opacity+(b.opacity-a.opacity)*eased};
}

export type AdjustmentController = { setSources(sources: AdjustmentSource[]): void; preview(id:string,patch:Partial<Clip>|null):boolean; dispose():void };
export function installAdjustmentLayers(initial: AdjustmentSource[]): AdjustmentController {
  type Clock={time():number;render:(...args:unknown[])=>unknown;eventCallback(name:string,callback?:()=>void):unknown;__hfReal?:Clock};
  const host=window as unknown as {__timelines:{revline:Clock};__revlineEffects?:{setTimedEffects(clips:Clip[]):void};__revlineAdjustmentController?:AdjustmentController};
  const clock=host.__timelines.revline.__hfReal??host.__timelines.revline;
  const composition=document.getElementById('composition')!;
  const entries=new Map<string,{clip:Clip;node:HTMLElement}>(), drafts=new Map<string,Partial<Clip>>();
  let signature='', hierarchy='',disposed=false;
  let nextIndex=Math.max(-1,...Array.from(document.querySelectorAll('[id]'),node=>Number(/^clip-(\d+)/.exec(node.id)?.[1]??-1)))+1;
  function paint(){
    if(disposed)return;
    const width=Number(composition.dataset.width),height=Number(composition.dataset.height),time=clock.time();
    for(const [id,entry] of entries){
      const clip={...entry.clip,...drafts.get(id)}, motion=adjustmentFrame(clip,time);
      const bars=clip.effectPreset==='cinematic-bars', solid=clip.effectPreset==='solid-color';
      entry.node.style.transform=bars||solid||clip.effectPreset==='zoom-blur'?'none':`translate(${motion.x*width}px,${motion.y*height}px) rotate(${motion.rotation}deg) scale(${motion.scale})`;
      entry.node.style.opacity=String(bars||solid||clip.effectPreset==='zoom-blur'?1:motion.opacity);
      entry.node.style.filter=bars||solid||clip.effectPreset==='zoom-blur'?'none':`brightness(${motion.brightness})`;
      if(solid){
        const rectangle=entry.node.querySelector<HTMLElement>(':scope > .solid-color-rectangle')!,settings=solidColorSettings(clip);
        rectangle.style.visibility=time>=clip.start&&time<clip.start+clip.duration?'visible':'hidden';
        rectangle.style.backgroundColor=settings.color;
        rectangle.style.left=`${settings.x*100}%`;rectangle.style.top=`${settings.y*100}%`;
        rectangle.style.width=`${settings.width*100}%`;rectangle.style.height=`${settings.height*100}%`;
        rectangle.style.opacity=String(settings.opacity*motion.opacity);
        rectangle.style.transform=`translate(-50%,-50%) translate(${motion.x*width}px,${motion.y*height}px) rotate(${motion.rotation}deg) scale(${motion.scale})`;
      }
      if(bars)for(const side of ['top','bottom']){
        const bar=entry.node.querySelector<HTMLElement>(`:scope > .cinematic-bars > .cinematic-bar.${side}`)!;
        const active=time>=clip.start&&time<clip.start+clip.duration;
        bar.style.visibility=active?'visible':'hidden';
        bar.style.height=`${cinematicBarSettings(clip).size*100}%`;
        bar.style.transform=`translateY(${(side==='top'?-100:100)*(1-(active?motion.opacity:0))}%)`;
      }
    }
  }
  function syncTimed(){host.__revlineEffects?.setTimedEffects(Array.from(entries,([id,entry])=>({...entry.clip,...drafts.get(id)})));}
  function setSources(sources:AdjustmentSource[]){
    const nextSignature=JSON.stringify(sources);if(nextSignature===signature)return;signature=nextSignature;
    const wanted=new Set(sources.map(source=>source.clip.id));
    for(const [id,entry] of entries)if(!wanted.has(id)){
      for(const child of Array.from(entry.node.children))if(!child.classList.contains('cinematic-bars')&&!child.classList.contains('solid-color-rectangle'))entry.node.parentNode!.insertBefore(child,entry.node);
      entry.node.remove();entries.delete(id);drafts.delete(id);
    }
    for(const {clip} of sources){
      let entry=entries.get(clip.id);
      if(!entry){
        let node=Array.from(document.querySelectorAll<HTMLElement>('[data-effect-clip]')).find(node=>node.dataset.effectClip===clip.id);
        if(!node){node=document.createElement('div');node.id=`clip-${nextIndex++}-motion`;node.className='adjustment-layer';node.dataset.effectClip=clip.id;composition.appendChild(node);}
        entry={clip,node};entries.set(clip.id,entry);
      }
      entry.clip=clip;drafts.delete(clip.id);
      const existing=Array.from(entry.node.children).find(node=>node.classList.contains('cinematic-bars'));
      if(clip.effectPreset==='cinematic-bars'&&!existing){
        const bars=document.createElement('div');bars.className='cinematic-bars';
        for(const side of ['top','bottom']){const bar=document.createElement('div');bar.className=`cinematic-bar ${side}`;bar.id=entry.node.id.replace(/-motion$/,'')+`-bar-${side}`;bars.appendChild(bar);}entry.node.appendChild(bars);
      }else if(clip.effectPreset!=='cinematic-bars')existing?.remove();
      const rectangle=Array.from(entry.node.children).find(node=>node.classList.contains('solid-color-rectangle'));
      if(clip.effectPreset==='solid-color'&&!rectangle){const node=document.createElement('div');node.className='solid-color-rectangle';entry.node.appendChild(node);}
      else if(clip.effectPreset!=='solid-color')rectangle?.remove();
      entry.node.style.zIndex=String(trackOf(clip)*256-1);
    }
    const ordered=Array.from(entries.values()).sort((a,b)=>trackOf(a.clip)-trackOf(b.clip)||sources.findIndex(source=>source.clip.id===a.clip.id)-sources.findIndex(source=>source.clip.id===b.clip.id));
    const nextHierarchy=ordered.map(entry=>entry.clip.id).join('|');
    if(nextHierarchy!==hierarchy){
      hierarchy=nextHierarchy;
      const base=Array.from(composition.querySelectorAll<HTMLElement>('.visual-frame,.overlay'));
      const inner=ordered[0]?.node??composition;
      for(const node of base)if(node.parentElement!==inner)inner.insertBefore(node,inner.firstChild);
      for(let index=0;index<ordered.length;index++){const parent=ordered[index+1]?.node??composition;if(ordered[index].node.parentElement!==parent)parent.insertBefore(ordered[index].node,parent.firstChild);}
    }
    syncTimed();paint();
  }
  const originalRender=clock.render,originalUpdate=clock.eventCallback('onUpdate') as (()=>void)|null;
  clock.render=function(...args){const result=originalRender.apply(clock,args);paint();return result;};
  clock.eventCallback('onUpdate',()=>{originalUpdate?.();paint();});
  const controller:AdjustmentController={setSources,preview:(id,patch)=>{if(!entries.has(id))return false;if(patch)drafts.set(id,patch);else drafts.delete(id);syncTimed();paint();return true;},dispose:()=>{disposed=true;clock.render=originalRender;clock.eventCallback('onUpdate',originalUpdate??undefined);}};
  host.__revlineAdjustmentController=controller;setSources(initial);window.addEventListener('pagehide',controller.dispose,{once:true});return controller;
}
