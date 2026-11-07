import { transitionSampleTime, transitionWipeSettings, type transitionSources } from './clip-transitions';
import { createPresentation, type PresentationBridge } from './transition-presentation';
import type { Clip, TransitionPreset } from './types';

export type TransitionSource = ReturnType<typeof transitionSources>[number];
export type TransitionController = {
  setSources(sources: TransitionSource[]): void;
  preview(id: string, patch: Partial<Clip> | null): boolean;
  whenReady(time: number, signal?: AbortSignal): Promise<void>;
  dispose(): void;
};
type Clock = { time(): number; render(...args: unknown[]): unknown; eventCallback(name: string, callback?: (() => void) | null): unknown; __hfReal?: Clock };
type FrameSource = { element: HTMLElement; render(time: number, signal: AbortSignal): Promise<void> };
type RuntimeWindow = Window & {
  __timelines: { revline: Clock }; __revlineTransitionController?: TransitionController;
  __HF_VIRTUAL_TIME__?: { originalSetTimeout: typeof window.setTimeout; originalClearTimeout: typeof window.clearTimeout; originalRequestAnimationFrame: typeof window.requestAnimationFrame; originalCancelAnimationFrame: typeof window.cancelAnimationFrame };
  __revlineEffects?: { redraw(): void }; __hyperframes?: { registerFrameSource(source: FrameSource): () => void };
};
type Entry = { source: TransitionSource; node: HTMLElement; presentation: PresentationBridge; frames?: [HTMLElement, HTMLElement] };

function moveRetained(parent: HTMLElement, child: HTMLElement, before: Node | null = null) {
  if (child.parentElement === parent && (!before || child.nextSibling === before)) return;
  const connected = parent as HTMLElement & { moveBefore?(node: Node, before: Node | null): void };
  if (connected.moveBefore && parent.isConnected && child.isConnected) connected.moveBefore(child, before);
  else parent.insertBefore(child, before);
}

/** Our presentation styles the two shots; HyperFrames owns the clock, native playback and audio. */
export function installTransitions(initial: TransitionSource[], projectFps: number): TransitionController {
  const host = window as unknown as RuntimeWindow, composition = document.getElementById('composition')!;
  const clock = host.__timelines.revline.__hfReal ?? host.__timelines.revline;
  const schedule = host.__HF_VIRTUAL_TIME__?.originalSetTimeout ?? window.setTimeout.bind(window), unschedule = host.__HF_VIRTUAL_TIME__?.originalClearTimeout ?? window.clearTimeout.bind(window);
  const mediaFrame = host.__HF_VIRTUAL_TIME__?.originalRequestAnimationFrame ?? window.requestAnimationFrame.bind(window), cancelMediaFrame = host.__HF_VIRTUAL_TIME__?.originalCancelAnimationFrame ?? window.cancelAnimationFrame.bind(window);
  const entries = new Map<string, Entry>(), drafts = new Map<string, Partial<Clip>>();
  const seeks = new Map<HTMLVideoElement, { target: number; promise: Promise<void>; cancel(): void }>();
  let disposed = false, signature = '', unregister: (() => void) | undefined;
  const anchor = document.createElement('span'); anchor.dataset.transitionFrameSource = '';
  anchor.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none'; composition.appendChild(anchor);
  const inner = () => Array.from(composition.querySelectorAll<HTMLElement>('.adjustment-layer')).find(node => !node.querySelector('.adjustment-layer')) ?? composition;
  const clipOf = (entry: Entry) => ({ ...entry.source.clip, ...drafts.get(entry.source.clip.id) });
  const active = (clip: Clip, time: number) => time >= clip.start - 1e-7 && time < clip.start + clip.duration - 1e-7;
  const mediaOf = (frame: HTMLElement) => frame.querySelector<HTMLVideoElement | HTMLImageElement>('video[data-source-clip],img[data-source-clip]');
  const injectedOf = (media: HTMLElement) => document.getElementById(`__render_frame_${media.getAttribute('data-hf-render-id') || media.id}__`);
  function sourceVisibility(media: HTMLVideoElement | HTMLImageElement, clip: Clip, time: number, transitioning: boolean) {
    const held = transitioning && !active(clip, time), injected = injectedOf(media);
    if (transitioning) media.dataset.revlineTransitionVisible = '';
    else delete media.dataset.revlineTransitionVisible;
    if (held && media instanceof HTMLVideoElement) media.dataset.revlineTransitionHold = '';
    else delete media.dataset.revlineTransitionHold;
    // Producer injects an image for the active authored clip. Inactive edge holds
    // use the retained native decoder, not that image's unrelated global frame.
    if (injected && media instanceof HTMLVideoElement) {
      media.style.setProperty('visibility', held ? 'visible' : 'hidden', 'important');
      injected.style.setProperty('visibility', held ? 'hidden' : active(clip, time) ? 'visible' : 'hidden', 'important');
    } else if (transitioning) media.style.setProperty('visibility', 'visible', 'important');
    else media.style.visibility = active(clip, time) ? '' : 'hidden';
    if (transitioning) media.style.setProperty('display', 'block', 'important');
    else media.style.removeProperty('display');
  }
  function restore(entry: Entry, time: number) {
    if (!entry.frames) return;
    const parent = entry.node.parentElement ?? inner();
    for (const [index, frame] of entry.frames.entries()) {
      const clip = index === 0 ? entry.source.from : entry.source.to;
      // Deleting source footage already removed its frame; never resurrect it.
      if (!frame.isConnected || !entry.node.contains(frame)) continue;
      const media = mediaOf(frame); if (media) { if(media instanceof HTMLVideoElement)seeks.get(media)?.cancel(); sourceVisibility(media, clip, time, false); }
      frame.style.mixBlendMode = clip.blendMode ?? 'normal';
      moveRetained(parent, frame, entry.node);
    }
    entry.frames = undefined; entry.node.style.display = 'none';
  }
  function mount(entry: Entry) {
    const frames = [entry.source.from, entry.source.to].map(clip => Array.from(composition.querySelectorAll<HTMLElement>('[data-visual-clip]')).find(frame => frame.dataset.visualClip === clip.id));
    if (!frames[0] || !frames[1]) return false;
    if (!entry.node.isConnected) inner().appendChild(entry.node);
    const blend = entry.source.from.blendMode ?? 'normal';
    entry.node.style.mixBlendMode = blend;
    frames.forEach(frame => { frame!.style.mixBlendMode = 'normal'; });
    moveRetained(entry.presentation.fromSlot, frames[0]); moveRetained(entry.presentation.toSlot, frames[1]);
    entry.frames = frames as [HTMLElement, HTMLElement]; return true;
  }
  function prepareVideo(video: HTMLVideoElement, target: number): Promise<void> {
    target-=Number(video.dataset.previewOffset??0);
    if (video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - target) < .002) return Promise.resolve();
    const prior = seeks.get(video); if (prior && Math.abs(prior.target - target) < .002) return prior.promise;
    prior?.cancel();
    let cancel!: () => void;
    const promise = new Promise<void>((resolve, reject) => {
      let timer: number, poll = 0, done = false;
      const finish = (error?: Error) => {
        if (done) return; done = true; unschedule(timer); cancelMediaFrame(poll);
        for (const name of ['loadedmetadata', 'loadeddata', 'seeked', 'error']) video.removeEventListener(name, check);
        if (seeks.get(video)?.target === target) seeks.delete(video);
        if (error) reject(error); else resolve();
      };
      const check = () => {
        if (disposed || !video.isConnected) { finish(); return; }
        if (video.error) { finish(new Error('Transition footage could not decode.')); return; }
        if (video.readyState >= 1 && !video.seeking && Math.abs(video.currentTime - target) >= .002) video.currentTime = target;
        if (video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - target) < .002) finish();
      };
      const tick = () => { check(); if (!done) poll = mediaFrame(tick); };
      cancel = () => finish();
      timer = schedule(() => finish(new Error(`Transition footage ${video.id} took too long to decode (ready ${video.readyState}, seeking ${video.seeking}, current ${video.currentTime}, target ${target}).`)), 10_000);
      for (const name of ['loadedmetadata', 'loadeddata', 'seeked', 'error']) video.addEventListener(name, check);
      video.preload = 'auto'; tick();
    });
    seeks.set(video, { target, promise, cancel }); promise.catch(() => {}); return promise;
  }
  function paint(time = clock.time()): Promise<void>[] {
    if (disposed) return [];
    // A shared middle clip belongs to only one non-overlapping transition band.
    for (const entry of entries.values()) if (!active(clipOf(entry), time)) restore(entry, time);
    const pending: Promise<void>[] = []; let warmed=0;
    for (const entry of Array.from(entries.values()).sort((a,b)=>clipOf(a).start-clipOf(b).start)) {
      const clip = clipOf(entry), visible = active(clip, time);
      if (!visible) {
        // Prime the incoming edge before the presentation starts, including long bands.
        if (clip.start > time && clip.start - time <= 1.5 && warmed<4) {
          const frame = Array.from(composition.querySelectorAll<HTMLElement>('[data-visual-clip]')).find(frame => frame.dataset.visualClip === entry.source.to.id);
          const video = frame && mediaOf(frame);
          if (video instanceof HTMLVideoElement && video.paused) { warmed++; pending.push(prepareVideo(video, transitionSampleTime(entry.source.to, clip.start, projectFps))); }
        }
        continue;
      }
      if (!entry.frames && !mount(entry)) continue;
      entry.node.style.display = '';
      entry.node.style.zIndex = String(Math.max(...entry.frames!.map(frame => Number(frame.style.zIndex))));
      entry.presentation.render({ ...transitionWipeSettings(clip.transition!), preset: clip.effectPreset as TransitionPreset, direction: clip.transition!.direction, progress: (time - clip.start) / clip.duration, durationInFrames: Math.max(1, Math.round(clip.duration * projectFps)), duration: clip.duration, outputHeight: Number(composition.dataset.height) });
      for (const [index, frame] of entry.frames!.entries()) {
        const sourceClip = index === 0 ? entry.source.from : entry.source.to, media = mediaOf(frame);
        if (!media) continue;
        sourceVisibility(media, sourceClip, time, true);
        if (media instanceof HTMLVideoElement && !active(sourceClip, time)) {
          if (!media.paused) media.pause();
          pending.push(prepareVideo(media, transitionSampleTime(sourceClip, time, projectFps)));
        } else if (media instanceof HTMLVideoElement) { seeks.get(media)?.cancel(); }
        else if (media instanceof HTMLImageElement && (!media.complete || !media.naturalWidth)) pending.push(media.decode());
      }
    }
    return pending;
  }
  async function whenReady(time: number, signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Cancelled', 'AbortError');
    const pending = Promise.all(paint(time));
    if (signal) {
      await new Promise<void>((resolve, reject) => {
        const abort = () => { cleanup(); reject(signal.reason ?? new DOMException('Cancelled', 'AbortError')); };
        const cleanup = () => signal.removeEventListener('abort', abort);
        signal.addEventListener('abort', abort, { once: true });
        pending.then(() => { cleanup(); resolve(); }, error => { cleanup(); reject(error); });
      });
    } else await pending;
    if (!disposed && Math.abs(clock.time() - time) < 1e-5) { paint(time); host.__revlineEffects?.redraw(); }
  }
  function bindExport() {
    if (!entries.size) { unregister?.(); unregister = undefined; return; }
    if (!unregister && host.__hyperframes) unregister = host.__hyperframes.registerFrameSource({ element: anchor, render: whenReady });
  }
  const report = (error: unknown) => { if (!disposed) window.dispatchEvent(new ErrorEvent('error', { error, message: String(error instanceof Error ? error.message : error) })); };
  const seek = (event: Event) => {
    const detail = (event as CustomEvent<{ time: number; waitUntil(promise: Promise<void>): void }>).detail;
    detail.waitUntil(whenReady(detail.time));
  };
  const previousRender = clock.render, previousUpdate = clock.eventCallback('onUpdate') as (() => void) | undefined;
  const update = () => { previousUpdate?.call(clock); bindExport();for (const pending of paint()) pending.catch(report); };
  const wrapped: Clock['render'] = function (...args) { const result = previousRender.apply(clock, args);bindExport(); for (const pending of paint()) pending.catch(report); return result; };
  clock.render = wrapped; clock.eventCallback('onUpdate', update); window.addEventListener('hf-seek', seek);
  const controller: TransitionController = {
    setSources(sources) {
      const next = JSON.stringify(sources); if (next === signature) return; signature = next;
      for(const request of seeks.values())request.cancel();seeks.clear();
      const wanted = new Set(sources.map(source => source.clip.id));
      for (const [id, entry] of entries) if (!wanted.has(id)) { restore(entry, clock.time()); entry.presentation.dispose(); entry.node.remove(); entries.delete(id); drafts.delete(id); }
      for (const source of sources) {
        let entry = entries.get(source.clip.id);
        if (!entry) { const node = document.createElement('div'); node.className = 'transition-pair'; node.dataset.transitionClip = source.clip.id; node.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:none'; inner().appendChild(node); entry = { source, node, presentation: createPresentation(node) }; entries.set(source.clip.id, entry); }
        else restore(entry, clock.time());
        entry.source = source; drafts.delete(source.clip.id);
      }
      bindExport(); for (const pending of paint()) pending.catch(report); host.__revlineEffects?.redraw();
    },
    preview(id, patch) { if (!entries.has(id)) return false; if (patch) drafts.set(id, patch); else drafts.delete(id); for (const pending of paint()) pending.catch(report); host.__revlineEffects?.redraw(); return true; },
    whenReady,
    dispose() {
      if (disposed) return; disposed = true; unregister?.(); window.removeEventListener('hf-seek', seek);
      for (const request of seeks.values()) request.cancel(); seeks.clear();
      for (const entry of entries.values()) { restore(entry, clock.time()); entry.presentation.dispose(); entry.node.remove(); } entries.clear(); anchor.remove();
      if (clock.render === wrapped) clock.render = previousRender; if (clock.eventCallback('onUpdate') === update) clock.eventCallback('onUpdate', previousUpdate ?? null);
    },
  };
  host.__revlineTransitionController = controller; controller.setSources(initial);
  window.addEventListener('pagehide', controller.dispose, { once: true }); return controller;
}
