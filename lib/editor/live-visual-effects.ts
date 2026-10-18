import { cameraGlideBlurSource } from './camera-motion-blur';
import { compositionIndex } from './composition-node';
import type { Clip, Timeline } from './types';
import { validateVisualEffects, visualEffectsOf } from './visual-effects';
import type { VisualEffectsController } from './visual-effects-runtime';

const effects = (clip:Clip)=>({...visualEffectsOf(clip),cameraGlideBlur:cameraGlideBlurSource(clip)});

export function previewVisualEffects(document: Document, clip: Clip, index: number, patch: Partial<Clip> | null): boolean {
  const controller = (document.defaultView as (Window & { __revlineEffects?: VisualEffectsController }) | null)?.__revlineEffects;
  if (!controller) return false;
  const next = { ...clip, ...patch };
  validateVisualEffects(next);
  controller.set(`clip-${index}`, effects(next));
  return true;
}

export function updateLiveVisualEffects(document: Document, previous: Timeline, next: Timeline): boolean {
  const old = new Map(previous.clips.map(clip => [clip.id, clip]));
  for (const [position, clip] of next.clips.entries()) {
    const index = compositionIndex(document, clip, position);
    if (clip.kind !== 'video' && clip.kind !== 'image') continue;
    const before = old.get(clip.id);
    if (JSON.stringify(before && effects(before)) === JSON.stringify(effects(clip))) continue;
    if (!previewVisualEffects(document, clip, index, null)) return false;
  }
  return true;
}
