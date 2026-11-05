import type { CompositionWindow } from './composition-window';
import { sceneLayerSources } from './scene-layers';
import { dimensions, type Timeline } from './types';
import { equalTimelineValue } from './timeline-equality';


/** Reconcile scene frames on the live clock; only changed documents reload. */
export function updateLiveScenes(document: Document, previous: Timeline, next: Timeline): boolean {
  const controller = (document.defaultView as CompositionWindow | null)?.__revlineSceneController;
  const composition = document.getElementById('composition');
  if (!controller || !composition) return false;
  // Media the page has no URL for needs a rebuilt composition.
  if (next.clips.some(clip => clip.kind === 'scene' && clip.scene?.media?.some(item => !controller.hasMedia?.(item.assetId)))) return false;
  const resolution = Math.round(Number(composition.dataset.width) / dimensions(next.aspectRatio, 1080).width * 1080) || 1080;
  const before = sceneLayerSources(previous, resolution), after = sceneLayerSources(next, resolution);
  if (!equalTimelineValue(before, after)) controller.setSources(after);
  return true;
}
