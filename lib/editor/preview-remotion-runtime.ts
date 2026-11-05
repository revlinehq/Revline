import { isTransitionClip } from './clip-transitions';
import type { Timeline } from './types';

import type { CompositionWindow } from './composition-window';
const loading = new WeakMap<Document, Promise<void>>();

/** First optional scene loads on this iframe; the native player and decoders stay mounted. */
export function loadPreviewRemotion(document: Document, timeline: Timeline): Promise<void> | null {
  const text = timeline.clips.some(clip => clip.kind === 'caption' || clip.kind === 'graphic');
  const transitions = timeline.clips.some(isTransitionClip);
  const host = document.defaultView as CompositionWindow | null;
  if ((!text || host?.__revlineRemotionText) && (!transitions || host?.__revlineRemotionTransitions)) return null;
  const pending = loading.get(document); if (pending) return pending;
  const url = document.querySelector<HTMLMetaElement>('meta[name="revline-remotion-runtime"]')?.content;
  if (!url) return Promise.reject(new Error('The optional preview renderer URL is unavailable.'));
  const script = document.createElement('script'); script.src = url; script.async = true;
  const promise = new Promise<void>((resolve, reject) => {
    script.onload = () => host?.__revlineRemotionText && host?.__revlineRemotionTransitions ? resolve() : reject(new Error('The optional preview renderer failed to initialize.'));
    script.onerror = () => reject(new Error('The optional preview renderer failed to load.'));
    document.head.appendChild(script);
  }).catch(error => { loading.delete(document); script.remove(); throw error; });
  loading.set(document, promise); return promise;
}
