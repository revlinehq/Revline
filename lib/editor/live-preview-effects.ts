import type { Timeline } from './types';
import { textLayerSources } from './text-layers';
import type { TextLayerController } from './remotion-text-runtime';

type PreviewWindow = Window & { __revlineTextLayerController?: TextLayerController;__revlineRemotionText?:{installTextLayers(sources:ReturnType<typeof textLayerSources>):TextLayerController} };
/** Apply text content, styling, entrances, addition and removal synchronously on the existing clock. */
export function updateLiveTextEffects(document: Document, _previous: Timeline, next: Timeline): boolean {
  const host=document.defaultView as PreviewWindow | null;
  let controller=host?.__revlineTextLayerController;
  if(!controller){
    if(!next.clips.some(clip=>clip.kind==='caption'||clip.kind==='graphic'))return true;
    if(!host?.__revlineRemotionText)return false;
    controller=host.__revlineTextLayerController=host.__revlineRemotionText.installTextLayers([]);
  }
  const composition=document.getElementById('composition'),width=Number(composition?.dataset.width),height=Number(composition?.dataset.height);
  const resolution=Number.isFinite(width)&&width>0&&Number.isFinite(height)&&height>0?Math.min(width,height):1080;
  controller.setSources(textLayerSources(next.clips, next.fps,resolution));
  return true;
}
