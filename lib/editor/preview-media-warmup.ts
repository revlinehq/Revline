import { previewMediaReady } from './preview-readiness';

const LOOKAHEAD_SECONDS = 6, KEEP_AFTER_END_SECONDS = .5, UPCOMING_PER_KIND = 2;

/** Keep only the media that is playing or about to play holding a source.
 * The browser serves a limited number of open media downloads per page, and a
 * paused element that once loaded keeps its download open. A long edit has a
 * video and a linked audio element per cut; left alone they exhaust that limit
 * and the next cut can never load (playback freezes for good). Every other
 * element gives up its source and gets it back when its turn comes. */
export function warmPreviewMedia(document: Document, readTime: () => number): () => void {
  let media: HTMLMediaElement[] = [], stopped = false;
  const primed = new WeakMap<HTMLMediaElement, string>();
  const pending = new Map<HTMLMediaElement, () => void>();
  const released = new WeakMap<HTMLMediaElement, string>();
  const refresh = () => { media = Array.from(document.querySelectorAll<HTMLMediaElement>('video[data-start],audio[data-start]')); };
  refresh();
  const Observer = document.defaultView!.MutationObserver;
  const observer = new Observer(refresh);
  // Player load can precede insertion of the composition root. Observe the
  // document so preparation survives that initial empty frame and root swaps.
  observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-start', 'data-media-start', 'src'] });
  const startOf = (node: HTMLMediaElement) => Number(node.dataset.start);
  const endOf = (node: HTMLMediaElement) => Number(node.dataset.end ?? startOf(node) + Number(node.dataset.duration));
  const audible = (node: HTMLMediaElement) => node.tagName === 'VIDEO' || Number(node.dataset.volume ?? 1) > 0;
  const sourceTimeAt = (node: HTMLMediaElement, time: number) => Number(node.dataset.mediaStart ?? 0) + (time - startOf(node)) * Number(node.dataset.playbackRate ?? 1);
  const bufferedTarget = (node:HTMLMediaElement,time:number) => {
    const target=sourceTimeAt(node,time),runway=Math.min(.15,Math.max(0,endOf(node)-time)*Number(node.dataset.playbackRate??1));
    for(let index=0;index<node.buffered.length;index++)if(node.buffered.start(index)<=target+.025&&node.buffered.end(index)>=target+runway-.025)return true;
    return false;
  };
  const forgetPending = (node: HTMLMediaElement) => { const listener = pending.get(node); if (listener) { node.removeEventListener('loadedmetadata', listener); pending.delete(node); } };
  const release = (node: HTMLMediaElement) => {
    const src = node.getAttribute('src');
    if (!src) return;
    forgetPending(node); primed.delete(node);
    released.set(node, src);
    node.preload = 'none'; node.removeAttribute('src'); node.load();
  };
  // Seek a (re)loaded element to where the timeline needs it, once metadata arrives.
  const position = (node: HTMLMediaElement, sourceTime: () => number, key?: string, stillWanted: () => boolean = () => true) => {
    if (pending.has(node)) return;
    const finish = () => {
      pending.delete(node); node.removeEventListener('loadedmetadata', finish);
      if (stopped || !node.isConnected || !node.paused || !stillWanted()) return;
      const target = sourceTime();
      if (Math.abs(node.currentTime - target) > .001) node.currentTime = target;
      if (key) primed.set(node, key);
    };
    if (node.readyState >= 1) finish();
    else { pending.set(node, finish); node.addEventListener('loadedmetadata', finish, { once: true }); }
  };
  const restore = (node: HTMLMediaElement) => {
    const src = released.get(node);
    released.delete(node);
    // Live edits may already have given the element a newer source.
    if (!src || node.getAttribute('src')) return false;
    node.preload = 'auto'; node.setAttribute('src', src);
    return true;
  };
  function tick() {
    if (stopped) return;
    const time = readTime();
    const compositionEnd = Number(document.getElementById?.('composition')?.dataset.duration ?? Infinity);
    const active = (node: HTMLMediaElement) => time >= startOf(node) && time < endOf(node);
    const heldAtEnd = (node: HTMLMediaElement) => Number.isFinite(compositionEnd) && time >= endOf(node) && endOf(node) >= compositionEnd - 1e-6;
    const connected = media.filter(node => node.isConnected);
    const upcoming = connected.filter(node => audible(node) && startOf(node) > time && startOf(node) <= time + LOOKAHEAD_SECONDS).sort((a, b) => startOf(a) - startOf(b));
    // Edits often cut twice within half a second (a talking-head cut, then B-roll over it).
    const nextVideos = upcoming.filter(node => node.tagName === 'VIDEO').slice(0, UPCOMING_PER_KIND);
    const nextAudio = upcoming.filter(node => node.tagName === 'AUDIO').slice(0, UPCOMING_PER_KIND);
    const keep = new Set<HTMLMediaElement>([...nextVideos, ...nextAudio]);
    for (const node of connected) {
      const transition = node.dataset.revlineTransitionVisible !== undefined;
      const recentlyEnded = time >= endOf(node) && time < endOf(node) + KEEP_AFTER_END_SECONDS;
      // Active media keeps its source even when silent: the runtime still plays it.
      if (active(node) || transition || recentlyEnded || heldAtEnd(node)) keep.add(node);
    }
    for (const node of connected) {
      if(node.hasAttribute('data-preview-pending'))continue;
      if (keep.has(node)) {
        // An active element that was released reloads at its current timeline position.
        if (restore(node) && active(node)) position(node, () => sourceTimeAt(node, readTime()));
        continue;
      }
      // Only paused, out-of-window elements are released; playing media is never cut off.
      if (node.paused) release(node);
    }
    const activeBlocked = connected.some(node => active(node) && audible(node) && (node.paused ? !previewMediaReady(node, time) : node.seeking || node.readyState < 3) && !bufferedTarget(node, time));
    for (const node of [...nextVideos, ...nextAudio]) {
      // A cold opening or scrub must win bandwidth over speculative future seeks,
      // except a cut starting within a second: cancelling it only moves the stall there.
      if (activeBlocked && startOf(node) - time > 1) { if (node.paused && node.networkState === 2) release(node); continue; }
      restore(node);
      const key = `${node.getAttribute('src')}|${node.dataset.mediaStart}`;
      const sourceTime = Number(node.dataset.mediaStart ?? 0);
      // New live nodes may receive native deferral after our first tick. Restore
      // the selected preload without resetting an already pending range seek.
      node.preload = 'auto';
      if ((primed.get(node) === key && Math.abs(node.currentTime - sourceTime) < .02) || !node.paused) continue;
      // The cut may start while metadata loads; the runtime's active seek then wins.
      position(node, () => sourceTime, key, () => readTime() < startOf(node));
    }
  }
  // Timer only prepares sources; it does not drive or delay the playback clock.
  const timer = setInterval(tick, 100); tick();
  return () => {
    stopped = true; clearInterval(timer); observer.disconnect();
    for (const [node, finish] of pending) node.removeEventListener('loadedmetadata', finish);
    pending.clear();
    // A disposed session hands elements back with their sources.
    for (const node of media) restore(node);
  };
}
