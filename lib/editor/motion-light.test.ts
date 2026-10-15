import { expect, test } from 'vitest';
import { DEFAULT_DIRECTIONAL_BLUR, DEFAULT_TURBULENT_DISPLACE, DEFAULT_LIGHT_SWEEP, VISUAL_EFFECT_LIMITS, validateVisualEffects, visualEffectsPatch, visualEffectsOf } from './visual-effects';
import { EFFECT_LIBRARY_CATALOG } from './effect-catalog';
import { visualEffectActionPatch } from './visual-effect-actions';
import { addMediaClip, duplicateClip, patchClip, splitClip } from './operations';
import { copyTimelineClips, pasteTimelineClips } from './clipboard';
import { resizeSelectedClips } from './timeline-controls';
import { EMPTY_TIMELINE, normalizeTimeline } from './types';

const defaults = { directionalBlur: DEFAULT_DIRECTIONAL_BLUR, turbulentDisplace: DEFAULT_TURBULENT_DISPLACE, lightSweep: DEFAULT_LIGHT_SWEEP };
const effects = { directionalBlur: { ...DEFAULT_DIRECTIONAL_BLUR, enabled: true, angle: 34 }, turbulentDisplace: { ...DEFAULT_TURBULENT_DISPLACE, enabled: true, speed: 0 }, lightSweep: { ...DEFAULT_LIGHT_SWEEP, enabled: true, color: '#1a92cc', position: .7 } };
test('active footage controls are discoverable while saved Light sweep stays compatible', () => {
  for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
    expect(defaults[key].enabled).toBe(false);
    expect(visualEffectsPatch({ kind: 'image' }, { [key]: { enabled: true } })).toEqual({ [key]: { ...defaults[key], enabled: true } });
    if(key === 'lightSweep')expect(EFFECT_LIBRARY_CATALOG.some(entry => String(entry.id) === key)).toBe(false);
    else expect(EFFECT_LIBRARY_CATALOG.find(entry => entry.id === key)?.visual).toBe(key);
  }
  expect(visualEffectsPatch({ kind: 'video', ...effects }, { lightSweep: { speed: 0 }, directionalBlur: { amount: 3 } })).toEqual({ lightSweep: { ...effects.lightSweep, speed: 0 }, directionalBlur: { ...effects.directionalBlur, amount: 3 } });
  const clip = { id: 'test', kind: 'video' as const, start: 0, duration: 5, sourceStart: 0, ...effects };
  expect(visualEffectActionPatch(clip, 'lightSweep', 'reset')).toEqual({ lightSweep: { ...DEFAULT_LIGHT_SWEEP, enabled: true } });
  expect(visualEffectActionPatch(clip, 'turbulentDisplace', 'remove')).toEqual({ turbulentDisplace: undefined });
  expect(visualEffectsOf(clip)).toMatchObject(effects);
});
test('finite bounded shader settings and hex color are required even when effects are disabled', () => {
  for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
    for (const [field, [min, max]] of Object.entries(VISUAL_EFFECT_LIMITS[key])) for (const value of [NaN, Infinity, min - .01, max + .01]) expect(() => validateVisualEffects({ kind: 'video', [key]: { ...defaults[key], [field]: value } })).toThrow(`${key}.${field}`);
    for (const kind of ['audio', 'caption', 'graphic', 'solid', 'effect'] as const) expect(() => validateVisualEffects({ kind, [key]: defaults[key] })).toThrow('video or image');
    expect(() => validateVisualEffects({ kind: 'image', [key]: { ...defaults[key], unknown: 1 } })).toThrow('Unknown');
  }
  for (const color of [undefined, 'white', '#fff', '#zzzzzz', '#ffffff00']) expect(() => validateVisualEffects({ kind: 'image', lightSweep: { ...DEFAULT_LIGHT_SWEEP, color } } as Parameters<typeof validateVisualEffects>[0])).toThrow('six-digit hex');
});
test('normalize, trim, split, duplicate and clipboard keep all controls on footage without copying them onto linked audio', () => {
  const timeline = patchClip(addMediaClip(EMPTY_TIMELINE, { _id: 'asset', kind: 'video', duration: 5, audioAssetId: 'audio' }, 'video'), 'video', effects);
  const trimmed = resizeSelectedClips(normalizeTimeline(timeline), [], ['video'], 'left', .2);
  const split = splitClip(trimmed, 'video', 2, 'tail'); const duplicate = duplicateClip(split, 'tail', 'copy');
  const copied = copyTimelineClips(duplicate, ['copy']); let id = 0;
  const pasted = pasteTimelineClips(duplicate, copied, 30, () => `pasted-${++id}`).timeline;
  for (const clip of pasted.clips) if (clip.kind === 'video') expect(clip).toMatchObject(effects); else for (const key of Object.keys(defaults)) expect(clip[key as keyof typeof effects]).toBeUndefined();
});
