import { compositionIndex } from './composition-node';
import type { Clip, Timeline } from './types';
import { validateVisualEffects } from './visual-effects';
import { clipVisualEffectSource as effects } from './visual-effect-sources';
import type { VisualEffectsController } from './visual-effects-runtime';
import { maskSources, type MaskController } from './masks';
import { audioReactiveSources, type AudioReactiveController } from './audio-reactive';
import type { TimelineLut } from './color-finish';

export function previewVisualEffects(document: Document, clip: Clip, index: number, patch: Partial<Clip> | null, luts?: TimelineLut[]): boolean {
  const controller = (document.defaultView as (Window & { __revlineEffects?: VisualEffectsController }) | null)?.__revlineEffects;
  if (!controller) return false;
  const next = { ...clip, ...patch };
  validateVisualEffects(next);
  controller.set(`clip-${index}`, effects(next, luts));
  return true;
}

export function updateLiveVisualEffects(document: Document, previous: Timeline, next: Timeline): boolean {
  const old = new Map(previous.clips.map(clip => [clip.id, clip]));
  for (const [position, clip] of next.clips.entries()) {
    const index = compositionIndex(document, clip, position);
    if (clip.kind !== 'video' && clip.kind !== 'image') continue;
    const before = old.get(clip.id);
    if (JSON.stringify(before && effects(before, previous.luts)) === JSON.stringify(effects(clip, next.luts))) continue;
    if (!previewVisualEffects(document, clip, index, null, next.luts)) return false;
  }
  // Masks repaint on the shared clock; hand them the new timeline (rebuild if the runtime is missing).
  const reactive = (document.defaultView as (Window & { __revlineAudioReactive?: AudioReactiveController }) | null)?.__revlineAudioReactive;
  const reactiveSources = audioReactiveSources(next.clips);
  if (!reactive && reactiveSources.length) return false;
  reactive?.setSources(reactiveSources);
  const masks = (document.defaultView as (Window & { __revlineMaskController?: MaskController }) | null)?.__revlineMaskController;
  const sources = maskSources(next.clips);
  if (!masks) return !sources.length;
  masks.setSources(sources);
  return true;
}
