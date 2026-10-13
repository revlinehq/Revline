import { generateComposition } from './composition';
import { clipVolumeEnvelope } from './clip-volume';
import { playbackRateOf, sourceTimeAt } from './playback-rate';
import { timelineDuration, type Clip, type MediaAsset, type Timeline } from './types';
import type { gsap } from 'gsap';

type MediaWindow=Window&{gsap?:typeof gsap;__timelines?:{revline?:gsap.core.Timeline&{__hfReal?:gsap.core.Timeline}};__revlineDurationTween?:gsap.core.Tween;__revlineNextMediaIndex?:number;__revlineEffects?:{set(id:string,effects:Partial<Clip>):void}};
const mediaClip=(clip:Clip)=>clip.kind==='video'||clip.kind==='image'||clip.kind==='audio';
const activeAt=(clip:Clip,time:number)=>time>=clip.start&&time<clip.start+clip.duration;

/** Reconcile trusted media nodes while retaining every surviving decoder and transport. */
export function updateLiveMediaContent(document:Document,previous:Timeline,next:Timeline,assets:MediaAsset[]):boolean {
  const host=document.defaultView as MediaWindow|null,clock=host?.__timelines?.revline?.__hfReal??host?.__timelines?.revline;
  const composition=document.getElementById('composition');if(!host?.gsap||!clock||!composition)return false;
  if(previous.aspectRatio!==next.aspectRatio||previous.fps!==next.fps)return false;
  const nodes=new Map(Array.from(document.querySelectorAll<HTMLElement>('[data-source-clip]'),node=>[node.dataset.sourceClip!,node]));
  const old=new Map(previous.clips.map(clip=>[clip.id,clip])),assetMap=new Map(assets.map(asset=>[asset._id,asset]));
  const nextMedia=next.clips.filter(mediaClip),wanted=new Set(nextMedia.map(clip=>clip.id)),time=clock.time();
  // At a split boundary the new right-hand clip inherits the already decoded
  // element under the playhead. The inactive left half can load independently.
  for(const clip of nextMedia)if(!nodes.has(clip.id)&&activeAt(clip,time)){
    const candidate=Array.from(nodes.entries()).find(([id])=>{
      const before=old.get(id),after=nextMedia.find(item=>item.id===id);
      return !!before&&before.assetId===clip.assetId&&before.kind===clip.kind&&activeAt(before,time)&&(!after||!activeAt(after,time))&&Math.abs(sourceTimeAt(before,time)-sourceTimeAt(clip,time))<1/next.fps;
    });
    if(candidate){const [id,node]=candidate;nodes.delete(id);node.dataset.sourceClip=clip.id;node.closest<HTMLElement>('[data-visual-clip]')?.setAttribute('data-visual-clip',clip.id);nodes.set(clip.id,node);}
  }
  const added=nextMedia.filter(clip=>!nodes.has(clip.id));
  let template:Document|undefined;
  if(added.length){
    const Parser=document.defaultView!.DOMParser;
    template=new Parser().parseFromString(generateComposition(next,assets,{preview:true,gsapUrl:'/vendor/gsap.min.js'}),'text/html');
  }
  const parent=Array.from(composition.querySelectorAll<HTMLElement>('.adjustment-layer')).find(node=>!node.querySelector('.adjustment-layer'))??composition;
  for(const clip of added){
    const source=Array.from(template!.querySelectorAll<HTMLElement>('[data-source-clip]')).find(node=>node.dataset.sourceClip===clip.id)!;
    const root=source.closest<HTMLElement>('.visual-frame')??source;
    const imported=document.importNode(root,true),previousPrefix=source.id;
    const index=host.__revlineNextMediaIndex??Math.max(-1,...Array.from(document.querySelectorAll('[id]'),node=>Number(/^clip-(\d+)/.exec(node.id)?.[1]??-1)))+1;
    host.__revlineNextMediaIndex=index+1;
    for(const node of [imported,...Array.from(imported.querySelectorAll<HTMLElement>('[id]'))])if(node.id.startsWith(previousPrefix))node.id=node.id.replace(previousPrefix,`clip-${index}`);
    (clip.kind==='audio'?composition:parent).appendChild(imported);
    const media=imported.matches('[data-source-clip]')?imported:imported.querySelector<HTMLElement>('[data-source-clip]')!;
    nodes.set(clip.id,media);
  }
  for(const [id,node] of nodes)if(!wanted.has(id)){
    if(node.tagName==='VIDEO'||node.tagName==='AUDIO')(node as HTMLMediaElement).pause();
    host.__revlineEffects?.set(node.id,{});
    const root=node.closest('.visual-frame')??node;
    for(const target of [root,...Array.from(root.querySelectorAll('*'))])for(const tween of clock.getTweensOf(target)){clock.remove(tween);tween.kill();}
    root.remove();nodes.delete(id);
  }
  for(const clip of nextMedia){
    const node=nodes.get(clip.id)!,asset=assetMap.get(clip.assetId!);if(!asset?.url)return false;
    const before=old.get(clip.id);
    if(before&&before.assetId!==clip.assetId)node.setAttribute('src',asset.url);
    const attrs={start:clip.start,duration:clip.duration,end:clip.start+clip.duration,mediaStart:clip.sourceStart,playbackRate:playbackRateOf(clip),volume:clip.volume??1};
    for(const [key,value] of Object.entries(attrs))if(node.dataset[key]!==String(value))node.dataset[key]=String(value);
    const envelope=clipVolumeEnvelope(clip.volume??1);if(node.dataset.automation!==envelope)node.dataset.automation=envelope;
  }
  const duration=Math.max(timelineDuration(next),1/next.fps);
  if(composition.dataset.duration!==String(duration)){
    composition.dataset.duration=String(duration);host.__revlineDurationTween?.kill();
    host.__revlineDurationTween=host.gsap.to({},{duration,paused:true});clock.add(host.__revlineDurationTween,0);host.__revlineDurationTween.paused(false);
  }
  return true;
}
