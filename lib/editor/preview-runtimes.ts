import { isTransitionClip } from './clip-transitions';
import type { Timeline } from './types';

import type { CompositionWindow } from './composition-window';
const loading = new WeakMap<Document, Map<string, Promise<void>>>();

function load(document: Document, meta: string, ready: () => boolean, label: string): Promise<void> | null {
  if (ready()) return null;
  let pending = loading.get(document);
  if (!pending) { pending = new Map(); loading.set(document, pending); }
  const existing = pending.get(meta); if (existing) return existing;
  const url = document.querySelector<HTMLMetaElement>(`meta[name="${meta}"]`)?.content;
  if (!url) return Promise.reject(new Error(`The ${label} renderer URL is unavailable.`));
  const script = document.createElement('script'); script.src = url; script.async = true;
  const promise = new Promise<void>((resolve, reject) => {
    script.onload = () => ready() ? resolve() : reject(new Error(`The ${label} renderer failed to initialize.`));
    script.onerror = () => reject(new Error(`The ${label} renderer failed to load.`));
    document.head.appendChild(script);
  }).catch(error => { pending.delete(meta); script.remove(); throw error; });
  pending.set(meta, promise); return promise;
}

/** Optional renderers load on this iframe the first time a timeline needs them; the native player and decoders stay mounted. */
export function loadPreviewRuntimes(document: Document, timeline: Timeline): Promise<void> | null {
  const host = document.defaultView as CompositionWindow | null;
  const loads = [
    timeline.clips.some(clip => clip.kind === 'caption' || clip.kind === 'graphic') ? load(document, 'revline-text-runtime', () => !!host?.__revlineTextRuntime, 'text') : null,
    timeline.clips.some(isTransitionClip) ? load(document, 'revline-transitions-runtime', () => !!host?.__revlineTransitions, 'transition') : null,
  ].filter((pending): pending is Promise<void> => pending !== null);
  return loads.length ? Promise.all(loads).then(() => undefined) : null;
}
