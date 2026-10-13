import { visibleMotion } from './clip-effects';
import type { Clip } from './types';

export type TextAnimationVars = Record<string, string | number | boolean>;
export type TextAnimationStep = { method: 'set' | 'to' | 'fromTo'; selector: string; at: number; vars: TextAnimationVars; from?: TextAnimationVars };

/** Shared animation program for exported compositions and immediate text edits. */
export function textAnimationSteps(clip: Clip, index: number, width: number, height: number, resolution = 1080): TextAnimationStep[] {
  if (clip.kind !== 'caption' && clip.kind !== 'graphic') return [];
  const steps: TextAnimationStep[] = [];
  const selector = `#clip-${index}-motion`, motion = visibleMotion(clip);
  const vars = (key: typeof motion[number]) => ({ x: key.x * width, y: key.y * height, scale: key.scale, rotation: key.rotation, opacity: key.opacity, filter: `brightness(${key.brightness})` });
  if (motion.length) {
    steps.push({ method: 'set', selector, vars: vars(motion[0]), at: 0 });
    for (let key = 1; key < motion.length; key++) steps.push({ method: 'fromTo', selector, from: vars(motion[key - 1]), vars: { ...vars(motion[key]), duration: motion[key].time - motion[key - 1].time, ease: 'none', immediateRender: false }, at: clip.start + motion[key - 1].time });
  }
  if (clip.animation === 'fade' || clip.animation === 'rise') {
    const duration = Math.min(.3, clip.duration / 3), selector = `#clip-${index} .text-content`;
    steps.push({ method: 'fromTo', selector, from: { opacity: 0, ...(clip.animation === 'rise' ? { y: 32 * resolution / 1080 } : {}) }, vars: { opacity: 1, y: 0, duration, ease: 'power2.out' }, at: clip.start });
    steps.push({ method: 'to', selector, vars: { opacity: 0, duration }, at: clip.start + clip.duration - duration });
  }
  return steps;
}

export function serializeTextAnimation(step: TextAnimationStep, variable = 'timeline'): string {
  return `${variable}.${step.method}('${step.selector}',${step.from ? `${JSON.stringify(step.from)},` : ''}${JSON.stringify(step.vars)},${step.at});`;
}
