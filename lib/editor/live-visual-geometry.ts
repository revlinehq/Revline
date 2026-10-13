import { visibleMotion, NEUTRAL_MOTION } from './clip-effects';
import { compositionIndex } from './composition-node';
import type { gsap } from 'gsap';
import { calculateVisualRect, trimmedFocus } from './composition';
import { playbackRateOf, timelineTimeAtSource } from './playback-rate';
import { DEFAULT_TRANSFORM, dimensions, type Clip, type MediaAsset, type Timeline } from './types';
import type { VisualEffectsController } from './visual-effects-runtime';

type PreviewWindow = Window & { gsap?: typeof gsap; __timelines?: { revline?: gsap.core.Timeline & { __hfReal?:gsap.core.Timeline } }; __revlineSourceTimelines?:Record<string,gsap.core.Timeline>; __revlineEffects?:VisualEffectsController };
const geometry = ({ crop, fit, transform, blendMode, start, duration, sourceStart, focus, motion, motionOffset }: Clip) => ({ crop, fit, transform, blendMode, start, duration, sourceStart, focus, motion, motionOffset });

/** Change the retained source geometry without replacing its decoded media or clock. */
export function updateLiveVisualGeometry(document:Document, previous:Timeline, next:Timeline, assets:MediaAsset[]):boolean {
  const old = new Map(previous.clips.map(clip => [clip.id,clip]));
  const sources = new Map(assets.map(asset => [asset._id,asset]));
  const { width,height } = dimensions(next.aspectRatio);
  const host = document.defaultView as PreviewWindow | null;
  let changed = false;
  for (const [position,clip] of next.clips.entries()) {
    const index = compositionIndex(document, clip, position);
    if (clip.kind !== 'video' && clip.kind !== 'image') continue;
    const before = old.get(clip.id);
    if (before && JSON.stringify(geometry(before)) === JSON.stringify(geometry(clip))) continue;
    const source = document.getElementById(`clip-${index}`);
    const frame = document.getElementById(`clip-${index}-frame`);
    const window = source?.closest<HTMLElement>('.source-window');
    const asset = clip.assetId ? sources.get(clip.assetId) : undefined;
    if (!source || !frame || !window || !asset) return false;
    changed = true;
    const clock = host?.__timelines?.revline?.__hfReal ?? host?.__timelines?.revline;
    const motionNode=frame.querySelector<HTMLElement>('.motion-frame');
    if(!clock||!host?.gsap||!motionNode)return false;
    const time=clock.time(),timelines=host.__revlineSourceTimelines??={};
    const existing=timelines[clip.id];if(existing){clock.remove(existing);existing.kill();}
    for(const target of [source,motionNode])for(const tween of clock.getTweensOf(target)){tween.kill();clock.remove(tween);}
    const child=host.gsap.timeline({paused:true});timelines[clip.id]=child;
    const keys=visibleMotion(clip),vars=(key:typeof NEUTRAL_MOTION)=>({x:key.x*width,y:key.y*height,scale:key.scale,rotation:key.rotation,opacity:key.opacity,filter:`brightness(${key.brightness})`});
    child.set(motionNode,vars(keys[0]??NEUTRAL_MOTION),0);
    for(let key=1;key<keys.length;key++)child.fromTo(motionNode,vars(keys[key-1]),{...vars(keys[key]),duration:keys[key].time-keys[key-1].time,ease:'none',immediateRender:false},clip.start+keys[key-1].time);
    const transform = { ...DEFAULT_TRANSFORM,...clip.transform };
    frame.style.left = `${(transform.x-.5)*width}px`; frame.style.top = `${(transform.y-.5)*height}px`;
    frame.style.transform = `rotate(${transform.rotation}deg) scale(${transform.scale})`;
    frame.style.opacity = String(transform.opacity); frame.style.mixBlendMode = clip.blendMode ?? 'normal';
    if (asset.width && asset.height) {
      const focus = trimmedFocus(clip);
      const rect = calculateVisualRect(asset.width,asset.height,width,height,clip.crop,focus[0],clip.fit);
      Object.assign(window.style,{left:`${rect.window.left}px`,top:`${rect.window.top}px`,width:`${rect.window.width}px`,height:`${rect.window.height}px`});
      Object.assign(source.style,{left:`${rect.left-rect.window.left}px`,top:`${rect.top-rect.window.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,objectFit:'fill'});
      if (focus.length) {
        child.set(source,{left:rect.left-rect.window.left,top:rect.top-rect.window.top},clip.start);
        for (let sample=1;sample<focus.length;sample++) {
          const nextRect = calculateVisualRect(asset.width,asset.height,width,height,clip.crop,focus[sample],clip.fit);
          child.to(source,{left:nextRect.left-nextRect.window.left,top:nextRect.top-nextRect.window.top,duration:(focus[sample].time-focus[sample-1].time)/playbackRateOf(clip),ease:'none'},timelineTimeAtSource(clip,focus[sample-1].time));
        }

      }
    } else {
      if (clip.crop) return false;
      Object.assign(window.style,{left:'0px',top:'0px',width:`${width}px`,height:`${height}px`});
      Object.assign(source.style,{left:'0px',top:'0px',width:'100%',height:'100%',objectFit:clip.fit ?? 'cover'});
    }
    clock.add(child,0);child.paused(false);child.totalTime(time,true);
  }
  if (changed) host?.__revlineEffects?.redraw();
  return true;
}
