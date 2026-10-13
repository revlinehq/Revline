import type { gsap } from 'gsap';
import { textAnimationSteps } from './text-animation';
import { validateClipEffects } from './clip-effects';
import { dimensions, type Timeline } from './types';

type PreviewWindow = Window & { gsap?: typeof gsap; __timelines?: { revline?: gsap.core.Timeline }; __revlineTextTimelines?: Record<string, gsap.core.Timeline> };

/** Replace text tweens inside the active composition without touching its media or clock. */
export function updateLiveTextEffects(document: Document, previous: Timeline, next: Timeline): boolean {
  const window = document.defaultView as PreviewWindow | null;
  const clock = window?.__timelines?.revline, engine = window?.gsap, timelines = window?.__revlineTextTimelines;
  if (!clock || !engine || !timelines) return false;
  const before = new Map(previous.clips.map(clip => [clip.id, clip]));
  const { width, height } = dimensions(next.aspectRatio);
  const time = clock.time();
  for (const [index, clip] of next.clips.entries()) {
    if (clip.kind !== 'caption' && clip.kind !== 'graphic') continue;
    const old = before.get(clip.id);
    if (old?.animation === clip.animation && old?.motion === clip.motion && old?.motionOffset === clip.motionOffset) continue;
    validateClipEffects(clip);
    const child = timelines[`clip-${index}`];
    const motion = document.getElementById(`clip-${index}-motion`), content = document.querySelector(`#clip-${index} .text-content`);
    if (!child || !motion || !content) return false;
    child.clear();
    engine.set(motion, { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, filter: 'brightness(1)' });
    engine.set(content, { opacity: 1, y: 0 });
    for (const step of textAnimationSteps(clip, index, width, height)) {
      const target = step.selector.endsWith('-motion') ? motion : content;
      if (step.method === 'fromTo') child.fromTo(target, step.from!, step.vars, step.at);
      else if (step.method === 'set') child.set(target, step.vars, step.at);
      else child.to(target, step.vars, step.at);
    }
    // Render only the changed child at the existing clock position. Seeking the
    // player itself would pause playback and resynchronize decoded video.
    child.totalTime(time, true);
  }
  return true;
}
