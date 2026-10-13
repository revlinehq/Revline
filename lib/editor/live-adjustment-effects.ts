import type { gsap } from 'gsap';
import { cinematicBarsAnimationSteps } from './adjustment-animation';
import { cinematicBarSettings, validateClipEffects } from './clip-effects';
import type { Clip, Timeline } from './types';

type AdjustmentWindow = Window & { gsap?: typeof gsap; __timelines?: { revline?: gsap.core.Timeline }; __revlineAdjustmentTimelines?: Record<string, gsap.core.Timeline> };
const renderedPrograms = new WeakMap<Document, Map<string, string>>();

export function previewAdjustmentEffect(document: Document, clip: Clip, index: number, patch: Partial<Clip> | null): boolean {
  if (clip.kind !== 'effect' || clip.effectPreset !== 'cinematic-bars') return false;
  const next = { ...clip, ...patch };
  validateClipEffects(next);
  const window = document.defaultView as AdjustmentWindow | null;
  const clock = window?.__timelines?.revline, child = window?.__revlineAdjustmentTimelines?.[`clip-${index}`];
  const bars = ['top', 'bottom'].map(side => document.getElementById(`clip-${index}-bar-${side}`));
  if (!clock || !child || bars.some(bar => !bar)) return false;
  const height = `${cinematicBarSettings(next).size * 100}%`;
  for (const bar of bars) if (bar!.style.height !== height) bar!.style.height = height;
  const steps = cinematicBarsAnimationSteps(next, index), program = JSON.stringify(steps);
  let rendered = renderedPrograms.get(document);
  if (!rendered) { rendered = new Map(); renderedPrograms.set(document, rendered); }
  if (program !== (rendered.get(clip.id) ?? JSON.stringify(cinematicBarsAnimationSteps(clip, index)))) {
    child.clear();
    for (const step of steps) {
      const target = document.querySelector(step.selector);
      if (step.method === 'fromTo') child.fromTo(target, step.from!, step.vars, step.at);
      else child.set(target, step.vars, step.at);
    }
  }
  rendered.set(clip.id, program);
  child.totalTime(clock.time(), true);
  return true;
}

/** Retain the player and clock while changing bar timing or settings in its existing layer. */
export function updateLiveAdjustmentEffects(document: Document, previous: Timeline, next: Timeline): boolean {
  const before = new Map(previous.clips.map(clip => [clip.id, clip]));
  for (const [index, clip] of next.clips.entries()) {
    if (clip.kind !== 'effect' || clip.effectPreset !== 'cinematic-bars') continue;
    const old = before.get(clip.id);
    if (old && cinematicBarSettings(old).size === cinematicBarSettings(clip).size && JSON.stringify(cinematicBarsAnimationSteps(old, index)) === JSON.stringify(cinematicBarsAnimationSteps(clip, index))) continue;
    if (!previewAdjustmentEffect(document, old ?? clip, index, { ...clip, cinematicBars: clip.cinematicBars, motion: clip.motion, motionOffset: clip.motionOffset })) return false;
  }
  return true;
}
