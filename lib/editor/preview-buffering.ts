type Playback = EventTarget & { paused: boolean; play(): void; pause(): void };

/** A decoded first frame does not prevent a later network/decode stall. */
export function guardPreviewBuffering(document: Document, player: Playback, readTime: () => number, onBuffering?: () => void) {
  let intended = !player.paused, held = false, disposed = false;
  let diagnosticTimer:ReturnType<typeof setTimeout>|undefined;
  const clearDiagnostic=()=>{if(diagnosticTimer!==undefined)clearTimeout(diagnosticTimer);diagnosticTimer=undefined;};
  const blocked = () => {
    const time = readTime();
    return Array.from(document.querySelectorAll<HTMLVideoElement>('video[data-start]')).some(node => {
      const start = Number(node.dataset.start), end = Number(node.dataset.end ?? start + Number(node.dataset.duration));
      // A source deliberately held past its own last frame cannot provide future data.
      const finished = node.ended || Number.isFinite(node.duration) && node.currentTime >= node.duration - .05;
      return time >= start && time < end && !finished && (node.seeking || node.readyState < 3);
    });
  };
  const recover = () => {
    if (disposed || !held || !intended || blocked()) return;
    held = false;clearDiagnostic();
    player.play();
  };
  const waiting = (event: Event) => {
    if (disposed || !intended || held || player.paused) return;
    const node = event.target as HTMLMediaElement;
    if (node?.tagName !== 'VIDEO' || !node.hasAttribute('data-start') || !blocked()) return;
    held = true;
    if(onBuffering)diagnosticTimer=setTimeout(()=>{diagnosticTimer=undefined;if(!disposed&&held&&intended)try{onBuffering();}catch{/* Diagnostics must not interrupt media recovery. */}},2000);
    // Audio can already be fully buffered and driving the transport clock.
    // Pause the shared transport rather than allowing it to outrun the picture.
    player.pause();
  };
  const played = () => { intended = true; };
  const paused = () => { if (!held) intended = false; };
  player.addEventListener('play', played); player.addEventListener('pause', paused); player.addEventListener('ended', paused);
  document.addEventListener('waiting', waiting, true);
  for (const name of ['canplay', 'seeked', 'loadeddata', 'playing', 'ended']) document.addEventListener(name, recover, true);
  return {
    play() { intended = true; if (held) recover(); else player.play(); },
    pause() { intended = false; held = false; clearDiagnostic();player.pause(); },
    cancel() { intended = false; held = false; clearDiagnostic(); },
    isBuffering: () => held,
    isPlaying: () => !disposed && (held ? intended : !player.paused),
    dispose() {
      disposed = true; intended = false; held = false;clearDiagnostic();
      player.removeEventListener('play', played); player.removeEventListener('pause', paused); player.removeEventListener('ended', paused);
      document.removeEventListener('waiting', waiting, true);
      for (const name of ['canplay', 'seeked', 'loadeddata', 'playing', 'ended']) document.removeEventListener(name, recover, true);
    },
  };
}
