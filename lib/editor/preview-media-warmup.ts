import { previewMediaReady } from './preview-readiness';

/** Give active footage and its next cut exclusive access to native video loading. */
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
    // Each clip streams through its own URL (clipMediaUrl), so elements no longer
    // share one stream. Prepare the next two video cuts: edits often cut twice
    // within half a second (a talking-head cut, then B-roll over it). Further
    // cuts wait, so open streams stay within the browser's preload budget.
    const upcoming=media.filter(node=>node.isConnected&&(node.tagName!=='AUDIO'||Number(node.dataset.volume??1)>0)&&Number(node.dataset.start)>time&&Number(node.dataset.start)<=time+6)
      .sort((a,b)=>Number(a.dataset.start)-Number(b.dataset.start));
    const nextVideos=upcoming.filter(node=>node.tagName==='VIDEO').slice(0,2),nextAudio=upcoming.find(node=>node.tagName==='AUDIO');
    // A cut starting within a second is needed now; cancelling it while the active
    // clip buffers only moves the stall to the next cut.
    const imminent=(node:HTMLMediaElement)=>Number(node.dataset.start)-time<=1;
    const compositionEnd=Number(document.getElementById?.('composition')?.dataset.duration??Infinity);
    const heldAtEnd=(node:HTMLMediaElement)=>{
      const end=Number(node.dataset.end??Number(node.dataset.start)+Number(node.dataset.duration));
      return Number.isFinite(compositionEnd)&&time>=end&&end>=compositionEnd-1e-6&&node.readyState>=2;
    };
    for(const node of media)if(node.tagName==='VIDEO'&&node.isConnected&&node.paused&&node.preload!=='none'&&node.dataset.revlineTransitionVisible===undefined&&
      !heldAtEnd(node)&&
      (time<Number(node.dataset.start)||time>=Number(node.dataset.end??Number(node.dataset.start)+Number(node.dataset.duration)))&&
      !(nextVideos.includes(node)&&(!activeBlocked||imminent(node)))){
      const listener=pending.get(node);if(listener){node.removeEventListener('loadedmetadata',listener);pending.delete(node);}
      primed.delete(node);node.preload='none';
      // An idle decoder has no competing request. Retain its decoded frame and
      // cached ranges; only an actual loading stream needs the aborting reload.
      if(node.networkState===2)node.load();
    }
    // A cold opening or scrub must win bandwidth over speculative future seeks.
    // Resume lookahead as soon as the current footage has real buffered runway.
    for (const node of [...nextVideos,nextAudio]) {
      if(activeBlocked&&!(node&&imminent(node)))continue;
      if(!node)continue;
      const key = `${node.getAttribute('src')}|${node.dataset.mediaStart}`;
      const sourceTime = Number(node.dataset.mediaStart ?? 0);
      // New live nodes may receive native deferral after our first tick. Restore
      // the selected preload without resetting an already pending range seek.
      node.preload = 'auto';
      if ((primed.get(node) === key && Math.abs(node.currentTime - sourceTime) < .02) || pending.has(node) || !node.paused) continue;
      const finish = () => {
        pending.delete(node); node.removeEventListener('loadedmetadata', finish);
        if (stopped || !node.isConnected || !node.paused || readTime() >= Number(node.dataset.start)) return;
        if (Math.abs(node.currentTime - sourceTime) > .001) node.currentTime = sourceTime;
        primed.set(node, key);
      };
      if (node.readyState >= 1) finish();
      else { pending.set(node, finish); node.addEventListener('loadedmetadata', finish, { once: true }); }
    }
  }
  // Timer only prepares sources; it does not drive or delay the playback clock.
  const timer = setInterval(tick, 100); tick();
  return () => { stopped = true; clearInterval(timer); observer.disconnect(); for (const [node, finish] of pending) node.removeEventListener('loadedmetadata', finish); pending.clear(); };
}
