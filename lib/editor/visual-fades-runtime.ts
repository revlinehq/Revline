import { validateVisualFade, visualFadeGain } from './visual-fades';
import type { Clip } from './types';

import type { CompositionClock, CompositionClockHost } from './composition-clock';
export type VisualFadeController = { setSources(clips: Clip[]): void; preview(id: string, patch: Partial<Clip> | null): boolean; dispose(): void };
type FadeWindow = CompositionClockHost & { __revlineVisualFadeController?: VisualFadeController };

/** One opacity carrier beneath transform/motion covers media and its retained GPU output. */
export function installVisualFades(clips: Clip[], projectFps?: number): VisualFadeController {
  const host = window as unknown as FadeWindow, clock = host.__timelines.revline.__hfReal ?? host.__timelines.revline;
  const fps = projectFps ?? Number(document.getElementById('composition')!.dataset.fps);
  const entries = new Map<string, { clip: Clip; node: HTMLElement }>(), drafts = new Map<string, Partial<Clip>>();
  let disposed = false;
  function paint() {
    if (disposed) return;
    const time = clock.time();
    for (const [id, entry] of entries) {
      const draft = drafts.get(id), clip = draft ? { ...entry.clip, ...draft } : entry.clip;
      // Transition edge holds use the first/last retained frame's opacity too.
      const local = Math.max(0, Math.min(Math.max(0, clip.duration - 1 / fps), time - clip.start));
      const opacity = String(visualFadeGain(clip, local));
      if (entry.node.style.opacity !== opacity) entry.node.style.opacity = opacity;
    }
  }
  const previousRender = clock.render, previousUpdate = clock.eventCallback('onUpdate') as (() => void) | undefined;
  const wrapped: CompositionClock['render'] = function (...args) { const result = previousRender.apply(clock, args); paint(); return result; };
  const update = () => { previousUpdate?.call(clock); paint(); };
  clock.render = wrapped; clock.eventCallback('onUpdate', update);
  const controller: VisualFadeController = {
    setSources(sources) {
      const frames = new Map(Array.from(document.querySelectorAll<HTMLElement>('[data-visual-clip]'), frame => [frame.dataset.visualClip!, frame]));
      const wanted = new Set(sources.filter(clip => clip.kind === 'video' || clip.kind === 'image').map(clip => clip.id));
      for (const [id, entry] of entries) if (!wanted.has(id)) { entry.node.style.opacity = ''; entries.delete(id); drafts.delete(id); }
      for (const clip of sources) if (wanted.has(clip.id)) {
        validateVisualFade(clip);
        const node = frames.get(clip.id)?.querySelector<HTMLElement>('.source-window');
        if (!node) continue;
        node.dataset.visualFade = clip.id;
        entries.set(clip.id, { clip, node }); drafts.delete(clip.id);
      }
      paint();
    },
    preview(id, patch) { if (!entries.has(id)) return false; if (patch) { validateVisualFade({ ...entries.get(id)!.clip, ...patch }); drafts.set(id, patch); } else drafts.delete(id); paint(); return true; },
    dispose() { if (disposed) return; disposed = true; if (clock.render === wrapped) clock.render = previousRender; if (clock.eventCallback('onUpdate') === update) clock.eventCallback('onUpdate', previousUpdate ?? null); entries.clear(); drafts.clear(); },
  };
  host.__revlineVisualFadeController = controller; controller.setSources(clips);
  window.addEventListener('pagehide', controller.dispose, { once: true }); return controller;
}

export function previewVisualFade(document: Document, clip: Clip, patch: Partial<Clip> | null) {
  return (document.defaultView as unknown as FadeWindow | null)?.__revlineVisualFadeController?.preview(clip.id, patch) ?? false;
}
