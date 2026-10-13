import type { gsap } from 'gsap';
import { textAnimationSteps } from './text-animation';
import { validateClipEffects } from './clip-effects';
import { dimensions, type Timeline } from './types';
import { remotionTextSources } from './remotion-text';
import type { RemotionTextController } from './remotion-text-runtime';
import { textStyle } from './text-style';

type PreviewWindow = Window & { gsap?: typeof gsap; __timelines?: { revline?: gsap.core.Timeline }; __revlineTextTimelines?: Record<string, gsap.core.Timeline>; __revlineRemotionController?: RemotionTextController };

/** Replace text tweens inside the active composition without touching its media or clock. */
export function updateLiveTextEffects(document: Document, previous: Timeline, next: Timeline): boolean {
  const window = document.defaultView as PreviewWindow | null;
  const clock = window?.__timelines?.revline, engine = window?.gsap, timelines = window?.__revlineTextTimelines;
  if (!clock || !engine || !timelines) return false;
  const before = new Map(previous.clips.map(clip => [clip.id, clip]));
  const { width, height } = dimensions(next.aspectRatio);
  const time = clock.time();
  if (next.clips.some(clip => clip.textTemplate) && !window.__revlineRemotionController) return false;
  const sources = remotionTextSources(next.clips, next.fps);
  if (JSON.stringify(sources) !== JSON.stringify(remotionTextSources(previous.clips, previous.fps))) window.__revlineRemotionController?.setSources(sources);
  for (const [index, clip] of next.clips.entries()) {
    if (clip.kind !== 'caption' && clip.kind !== 'graphic') continue;
    const old = before.get(clip.id);
    const style = textStyle(clip), oldStyle = old ? textStyle(old) : undefined;
    const steps = clip.textTemplate ? [] : textAnimationSteps(clip, index, width, height);
    const oldSteps = !old || old.textTemplate ? [] : textAnimationSteps(old, index, width, height);
    const styleChanged = JSON.stringify(style) !== JSON.stringify(oldStyle);
    const animationChanged = !old || JSON.stringify(steps) !== JSON.stringify(oldSteps);
    const plainTextChanged = !clip.textTemplate && (oldStyle?.text !== style.text || !!old?.textTemplate);
    if (!styleChanged && !animationChanged && !plainTextChanged) continue;
    validateClipEffects(clip);
    const child = timelines[`clip-${index}`];
    const node = document.getElementById(`clip-${index}`), motion = document.getElementById(`clip-${index}-motion`), content = document.querySelector<HTMLElement>(`#clip-${index} .text-content`);
    if (!child || !node || !motion || !content) return false;
    if (styleChanged) {
      node.style.left = `${style.x * 100}%`; node.style.top = `${style.y * 100}%`;
      node.style.fontSize = `${style.fontSize}px`; node.style.color = style.color;
      node.style.mixBlendMode = style.blendMode; content.style.background = style.background;
      node.style.transform = style.transform;
    }
    if (plainTextChanged) content.textContent = style.text;
    if (!animationChanged) continue;
    child.clear();
    engine.set(motion, { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, filter: 'brightness(1)' });
    engine.set(content, { opacity: 1, y: 0 });
    for (const step of steps) {
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
