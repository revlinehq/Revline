import type { gsap } from 'gsap';
import { textAnimationSteps } from './text-animation';
import { validateClipEffects } from './clip-effects';
import { dimensions, type Timeline } from './types';
import { remotionTextSources } from './remotion-text';
import type { RemotionTextController } from './remotion-text-runtime';

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
  window.__revlineRemotionController?.setSources(remotionTextSources(next.clips, next.fps));
  for (const [index, clip] of next.clips.entries()) {
    if (clip.kind !== 'caption' && clip.kind !== 'graphic') continue;
    const old = before.get(clip.id);
    validateClipEffects(clip);
    const child = timelines[`clip-${index}`];
    const node = document.getElementById(`clip-${index}`), motion = document.getElementById(`clip-${index}-motion`), content = document.querySelector<HTMLElement>(`#clip-${index} .text-content`);
    if (!child || !node || !motion || !content) return false;
    const bounded = (value: number | undefined, fallback: number, min: number, max: number) => Number.isFinite(value) ? Math.max(min, Math.min(max, value!)) : fallback;
    const color = (value: string | undefined, fallback: string) => value && /^(#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|transparent)$/i.test(value) ? value : fallback;
    node.style.left = `${bounded(clip.x, .5, 0, 1) * 100}%`;
    node.style.top = `${bounded(clip.y, clip.kind === 'caption' ? .82 : .5, 0, 1) * 100}%`;
    node.style.fontSize = `${bounded(clip.fontSize, clip.kind === 'caption' ? 52 : 92, 8, 300)}px`;
    node.style.color = color(clip.color, '#F4F4F0');
    node.style.mixBlendMode = clip.blendMode ?? 'normal';
    content.style.background = color(clip.background, 'transparent');
    if (!clip.textTemplate && (old?.text !== clip.text || old?.textTemplate)) content.textContent = (clip.text ?? '').slice(0, 2000);
    if (old?.animation === clip.animation && old?.motion === clip.motion && old?.motionOffset === clip.motionOffset && old?.textTemplate === clip.textTemplate) continue;
    child.clear();
    engine.set(motion, { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, filter: 'brightness(1)' });
    engine.set(content, { opacity: 1, y: 0 });
    for (const step of clip.textTemplate ? [] : textAnimationSteps(clip, index, width, height)) {
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
