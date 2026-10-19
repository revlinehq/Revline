/** Decode the next cut before it becomes visible, with a small bounded lookahead. */
export function warmPreviewMedia(document: Document, readTime: () => number): () => void {
  let media: HTMLMediaElement[] = [], stopped = false;
  const primed = new WeakMap<HTMLMediaElement, string>();
  const pending = new Map<HTMLMediaElement, () => void>();
  const refresh = () => { media = Array.from(document.querySelectorAll<HTMLMediaElement>('video[data-start],audio[data-start]')); };
  refresh();
  const Observer = document.defaultView!.MutationObserver;
  const observer = new Observer(refresh);
  // Player load can precede insertion of the composition root. Observe the
  // document so preparation survives that initial empty frame and root swaps.
  observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-start', 'data-media-start', 'src'] });
  function tick() {
    if (stopped) return;
    const time = readTime();
    // The player can promote every metadata probe to auto before readiness.
    // Cold distant video requests then compete with the active range seek.
    // Cancel only those not-yet-decoded future loads; retain buffered decoders.
    for(const node of media)if(node.tagName==='VIDEO'&&node.isConnected&&node.paused&&node.readyState===0&&Number(node.dataset.start)-time>6&&node.preload!=='none'){
      node.preload='none';node.load();
    }
    // A paused clock must still retry a source whose metadata/play state settled
    // after the first tick. The per-source key below skips already primed media.
    // Do not preload the whole project: at most four imminent sources.
    const upcoming = media.filter(node => {
      const due = Number(node.dataset.start) - time;
      // Large originals can take several seconds to service a cold range seek.
      // Keep the four-source cap, but start before that wait reaches the cut.
      return node.isConnected && (node.tagName!=='AUDIO'||Number(node.dataset.volume??1)>0) && due > 0 && due <= 6;
    }).sort((a, b) => Number(a.dataset.start) - Number(b.dataset.start)).slice(0, 4);
    for (const node of upcoming) {
      const key = `${node.getAttribute('src')}|${node.dataset.mediaStart}`;
      const sourceTime = Number(node.dataset.mediaStart ?? 0);
      if ((primed.get(node) === key && Math.abs(node.currentTime - sourceTime) < .02) || pending.has(node) || !node.paused) continue;
      const finish = () => {
        pending.delete(node); node.removeEventListener('loadedmetadata', finish);
        if (stopped || !node.isConnected || !node.paused || readTime() >= Number(node.dataset.start)) return;
        if (Math.abs(node.currentTime - sourceTime) > .001) node.currentTime = sourceTime;
        primed.set(node, key);
      };
      node.preload = 'auto';
      if (node.readyState >= 1) finish();
      else { pending.set(node, finish); node.addEventListener('loadedmetadata', finish, { once: true }); }
    }
  }
  // Timer only prepares sources; it does not drive or delay the playback clock.
  const timer = setInterval(tick, 100); tick();
  return () => { stopped = true; clearInterval(timer); observer.disconnect(); for (const [node, finish] of pending) node.removeEventListener('loadedmetadata', finish); pending.clear(); };
}
