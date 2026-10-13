import { visibleMotion } from './clip-effects';
import type { TextAnimationStep as AnimationStep } from './text-animation';
import type { Clip } from './types';

/** One bar animation program drives the immediate preview and exported composition. */
export function cinematicBarsAnimationSteps(clip: Clip, index: number): AnimationStep[] {
  if (clip.kind !== 'effect' || clip.effectPreset !== 'cinematic-bars') return [];
  const motion = visibleMotion(clip), steps: AnimationStep[] = [];
  for (const side of ['top', 'bottom'] as const) {
    const selector = `#clip-${index}-bar-${side}`, direction = side === 'top' ? -100 : 100;
    const vars = (opacity: number) => ({ y: 0, yPercent: direction * (1 - opacity) });
    steps.push({ method: 'set', selector, vars: vars(0), at: 0 });
    steps.push({ method: 'set', selector, vars: vars(motion[0].opacity), at: clip.start });
    for (let frame = 1; frame < motion.length; frame++) steps.push({ method: 'fromTo', selector, from: vars(motion[frame - 1].opacity), vars: { ...vars(motion[frame].opacity), duration: motion[frame].time - motion[frame - 1].time, ease: 'power2.inOut', immediateRender: false }, at: clip.start + motion[frame - 1].time });
    steps.push({ method: 'set', selector, vars: vars(0), at: clip.start + clip.duration });
  }
  return steps;
}
