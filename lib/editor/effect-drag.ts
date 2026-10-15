import { EFFECT_PRESETS, type EffectPreset } from './clip-effects';
import { addEffectClip, patchClip } from './operations';
import { visualEffectsPatch, VISUAL_EFFECT_KEYS, type VisualEffects } from './visual-effects';
import { layerGroup, trackOf, type Timeline, type LayerGroup } from './types';
import { isTransitionPreset } from './clip-transitions';
import { placeTransitionAt } from './transition-placement';

export const EFFECT_DRAG_TYPE = 'application/x-revline-effect';
export type EffectDrag = { preset: EffectPreset } | { visual: keyof VisualEffects };
export function readEffectDrag(value: string): EffectDrag | null {
  try {
    const input = JSON.parse(value);
    if (EFFECT_PRESETS.includes(input?.preset)) return { preset: input.preset };
    if (VISUAL_EFFECT_KEYS.includes(input?.visual)) return { visual: input.visual };
  } catch { /* Another drag type or malformed payload. */ }
  return null;
}

/** Timed effects land on FX; footage controls apply only to the dropped-on clip. */
export function dropLibraryEffect(timeline: Timeline, effect: EffectDrag, at: number, group: LayerGroup, track: number, targetId?: string, id = crypto.randomUUID()): Timeline {
  if ('preset' in effect) {
    if(effect.preset==='solid-color'){
      if(group!=='visual')throw new Error('Drop solid color onto a V track (visual layer).');
      return addEffectClip(timeline,id,effect.preset,at,{track});
    }
    const transition=isTransitionPreset(effect.preset);
    if(transition&&group!=='visual'&&group!=='effects')throw new Error('Drop a transition onto a video/image cut or an FX track.');
    if(transition)return placeTransitionAt(timeline,id,effect.preset as import('./clip-transitions').TransitionPreset,at,{track:group==='effects'?track:undefined,...(group==='visual'?{aboveClipId:targetId,visualTrack:track}:{})});
    return addEffectClip(timeline, id, effect.preset, at, { track: group === 'effects' ? track : undefined,
      ...(transition&&group==='visual'?{aboveClipId:targetId,visualTrack:track}:{}),
    });
  }
  const clip = timeline.clips.find(clip => clip.id === targetId) ?? timeline.clips.find(clip => layerGroup(clip.kind) === group && trackOf(clip) === track && at >= clip.start && at < clip.start + clip.duration);
  if (!clip || (clip.kind !== 'video' && clip.kind !== 'image')) throw new Error('Drop this effect onto a video or image clip.');
  return patchClip(timeline, clip.id, visualEffectsPatch(clip, { [effect.visual]: { enabled: true } }));
}
