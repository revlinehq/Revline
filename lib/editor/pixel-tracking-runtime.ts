import type { CompositionClock, CompositionClockHost } from './composition-clock';
import type { Clip, ClipMask } from './types';
import { dimensions } from './types';
import { attachOverlayPatch, attachMaskPatch } from './tracking-attach';
import { motionAt } from './motion-path';
import { maskAt, maskSvg } from './masks';
import { sourceTimeAt } from './playback-rate';
import { localPixelTrackReader, readPixelTrackPage, waitForTrackPoll, type CompletedTrackPage } from '../media-analysis/pixel-track-reader';

type Source = { clip: Clip; index: number };
export const pixelTrackingSources = (clips: Clip[]): Source[] => clips.flatMap((clip, index) => clip.pixelTracking ? [{ clip, index }] : []);

/** Only neighboring data chunks are live. The producer's seek-completion hook awaits their paint. */
export function installPixelTracking(sources: Source[], endpoint: string, files: Record<string, string>, fps: number, resolution: number) {
  const host = window as unknown as CompositionClockHost & { __hfWaitForSeekCompletion?: () => Promise<void> };
  const clock = host.__timelines.revline.__hfReal ?? host.__timelines.revline, abort = new AbortController();
  const entries = sources.map(source => {
    const file = files[source.clip.pixelTracking!.reference.trackId];
    return { ...source, reader: file ? localPixelTrackReader(new URL(file, document.baseURI).href, abort.signal) : undefined, page: undefined as CompletedTrackPage | undefined, pending: undefined as Promise<void> | undefined, error: undefined as unknown, motion: undefined as Clip['motion'], mask: undefined as ClipMask | undefined };
  });
  let disposed = false, waitWrapper: (() => Promise<void>) | undefined;
  const emptyMask = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  function referenceTime(clip: Clip, time: number) { const binding = clip.pixelTracking!; return binding.attachedStart + time - clip.start + (clip.motionOffset ?? 0) - binding.attachedMotionOffset; }
  function active(entry: typeof entries[number], time: number) {
    const clip = entry.clip, binding = clip.pixelTracking!, at = referenceTime(clip, time);
    return time >= clip.start && time < clip.start + clip.duration && at >= binding.footage.start && at < binding.footage.start + binding.footage.duration;
  }
  function moveNode(entry: typeof entries[number]) {
    return entry.clip.kind === 'solid' ? document.querySelector<HTMLElement>(`[data-solid-color-clip="${CSS.escape(entry.clip.id)}"] > .solid-color-rectangle`) : document.getElementById(`clip-${entry.index}-motion`);
  }
  function hide(entry: typeof entries[number]) {
    const node = entry.clip.pixelTracking!.mode === 'mask' ? document.getElementById(`clip-${entry.index}-frame`) : moveNode(entry);
    if (node) { if (entry.clip.pixelTracking!.mode === 'move') node.style.opacity = '0'; else node.style.maskImage = `url("data:image/svg+xml,${encodeURIComponent(emptyMask)}")`; }
  }
  function compile(entry: typeof entries[number], page: CompletedTrackPage) {
    const binding = entry.clip.pixelTracking!;
    const options = { smoothing: binding.smoothing, followTransform: binding.followTransform, seedTime: page.summary.seedTime, visibleUntil: page.summary.forward.time, fps };
    if (binding.mode === 'move') {
      const target = { ...entry.clip, start: binding.attachedStart, duration: binding.attachedDuration, motionOffset: 0, pixelTracking: undefined };
      entry.motion = attachOverlayPatch(target, binding.footage, binding, binding.aspectRatio, page.samples, { x: binding.offsetX, y: binding.offsetY }, options).motion;
    } else entry.mask = attachMaskPatch(binding.target, binding.footage, binding, binding.aspectRatio, page.samples, binding.mask, options).mask;
  }
  async function load(entry: typeof entries[number], time: number) {
    const binding = entry.clip.pixelTracking!;
    let page = entry.reader ? await entry.reader(time) : await readPixelTrackPage(endpoint, binding.reference, { time }, abort.signal);
    while (page.status === 'queued') { await waitForTrackPoll(abort.signal); page = await readPixelTrackPage(endpoint, binding.reference, { time }, abort.signal); }
    if (page.status === 'failed') throw new Error(page.error);
    entry.page = page;
    entry.motion = undefined; entry.mask = undefined;
    if (time >= page.summary.firstTime && time < page.summary.forward.time && page.samples.length) compile(entry, page);
  }
  function paint() {
    if (disposed) return;
    // HyperFrames installs this hook during initialization. Preserve its own waits.
    if (host.__hfWaitForSeekCompletion !== waitWrapper) {
      const previous = host.__hfWaitForSeekCompletion;
      waitWrapper = async () => { await previous?.(); await ready(); };
      host.__hfWaitForSeekCompletion = waitWrapper;
    }
    const time = clock.time();
    for (const entry of entries) {
      const clip = entry.clip, binding = clip.pixelTracking!, at = referenceTime(clip, time), source = sourceTimeAt(binding.footage, at);
      if (!active(entry, time)) { hide(entry); continue; }
      const page = entry.page;
      if (page && (source < page.summary.firstTime || source >= page.summary.forward.time)) { hide(entry); continue; }
      if (!page || source < page.window.start || source >= page.window.end || (binding.mode === 'move' ? !entry.motion : !entry.mask)) {
        hide(entry);
        if (!entry.pending && !entry.error) entry.pending = load(entry, source).catch(error => { if (abort.signal.aborted) return; entry.error = error; console.error('Pixel tracking data failed', { trackId: binding.reference.trackId, message: error instanceof Error ? error.message : String(error) }); }).finally(() => { entry.pending = undefined; paint(); });
        continue;
      }
      const after=page.samples.findIndex(sample=>sample.time>source);
      const before=after<0?page.samples[page.samples.length-1]:page.samples[Math.max(0,after-1)];
      if(before?.confidence===0){hide(entry);continue;}
      const { width, height } = dimensions(binding.aspectRatio, resolution);
      if (binding.mode === 'move') {
        const node = moveNode(entry);
        if (!node || !entry.motion?.length) continue;
        const motion = motionAt(entry.motion, at - binding.attachedStart);
        node.style.opacity = String(motion.opacity);
        const prefix = clip.kind === 'solid' ? 'translate(-50%,-50%) ' : '';
        node.style.transform = `${prefix}translate(${motion.x * width}px,${motion.y * height}px) rotate(${motion.rotation}deg) scale(${motion.scale})`;
      } else {
        const node = document.getElementById(`clip-${entry.index}-frame`);
        if (!node || !entry.mask) continue;
        const svg = maskSvg(entry.mask, maskAt(entry.mask.keys, at - binding.attachedStart + (binding.target.motionOffset ?? 0)), width, height);
        node.style.maskImage = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`; node.style.maskSize = '100% 100%'; node.style.maskRepeat = 'no-repeat';
      }
    }
  }
  async function ready() {
    while (!disposed) {
      paint();
      const visible = entries.filter(entry => active(entry, clock.time())), pending = visible.flatMap(entry => entry.pending ? [entry.pending] : []);
      if (!pending.length) { const failed = visible.find(entry => entry.error); if (failed) throw failed.error; return; }
      await Promise.all(pending);
    }
  }
  const originalRender = clock.render, originalUpdate = clock.eventCallback('onUpdate') as (() => void) | null;
  const render: CompositionClock['render'] = function (...args) { const result = originalRender.apply(clock, args); paint(); return result; };
  const update = () => { originalUpdate?.(); paint(); };
  clock.render = render; clock.eventCallback('onUpdate', update); paint();
  const dispose = () => { disposed = true; abort.abort(); if (clock.render === render) clock.render = originalRender; if (clock.eventCallback('onUpdate') === update) clock.eventCallback('onUpdate', originalUpdate ?? undefined); };
  window.addEventListener('pagehide', dispose, { once: true });
  return { ready, dispose };
}
