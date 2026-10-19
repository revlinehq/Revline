import { previewMediaReady } from './preview-readiness';

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
  const bufferedTarget = (node:HTMLMediaElement,time:number) => {
    const start=Number(node.dataset.start),end=Number(node.dataset.end??start+Number(node.dataset.duration));
    const rate=Number(node.dataset.playbackRate??1),target=Number(node.dataset.mediaStart??0)+(time-start)*rate;
    const runway=Math.min(.15,Math.max(0,end-time)*rate);
    for(let index=0;index<node.buffered.length;index++)if(node.buffered.start(index)<=target+.025&&node.buffered.end(index)>=target+runway-.025)return true;
    return false;
  };
  function tick() {
    if (stopped) return;
    const time = readTime();
    const activeBlocked=media.some(node=>{
      const start=Number(node.dataset.start),end=start+Number(node.dataset.duration);
      return node.isConnected&&time>=start&&time<end&&(node.tagName==='VIDEO'||Number(node.dataset.volume??1)>0)&&(node.paused?!previewMediaReady(node,time):node.seeking||node.readyState<3)&&!bufferedTarget(node,time);
    });
    // The player can promote every metadata probe to auto before readiness.
    // Paused, decoded cuts can still retain loading streams. When the current
    // range is blocked, release all inactive video streams, including previous
    // cuts and correctly primed future cuts, so they cannot starve its request.
    for(const node of media)if(node.tagName==='VIDEO'&&node.isConnected&&node.paused&&node.preload!=='none'&&(
      activeBlocked&&node.networkState===2&&(time<Number(node.dataset.start)||time>=Number(node.dataset.end??Number(node.dataset.start)+Number(node.dataset.duration)))||
      Number(node.dataset.start)-time>6&&node.readyState<2
    )){
      const listener=pending.get(node);if(listener){node.removeEventListener('loadedmetadata',listener);pending.delete(node);}
      primed.delete(node);node.preload='none';node.load();
    }
    // A cold opening or scrub must win bandwidth over speculative future seeks.
    // Resume lookahead as soon as the current footage has real buffered runway.
    if(activeBlocked)return;
    // A paused clock must still retry a source whose metadata/play state settled
    // after the first tick. The per-source key below skips already primed media.
    // Prepare at most four cold imminent sources. Decoded cuts do not consume
    // preparation slots while later footage is still waiting to start.
    const upcoming = media.filter(node => {
      const due = Number(node.dataset.start) - time;
      // Large originals can take several seconds to service a cold range seek.
      // Keep the four-source cap, but start before that wait reaches the cut.
      const start=Number(node.dataset.start),sourceTime=Number(node.dataset.mediaStart??0);
      const prepared=Math.abs(node.currentTime-sourceTime)<.02&&previewMediaReady(node,start);
      return node.isConnected && (node.tagName!=='AUDIO'||Number(node.dataset.volume??1)>0) && due > 0 && due <= 6 && !prepared;
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
