type Fallback = 'blocked' | 'error' | null;

/** Shared by the on-page films and the clipping montage's detached decoders. */
export function createLandingVideoPlayback(video: HTMLVideoElement, onFallback: (reason: Fallback) => void) {
  let wanted = false, disposed = false, pending = false, blocked = false;
  let retries = 0;
  let currentFallback: Fallback = null;
  let retry: ReturnType<typeof setTimeout> | undefined;

  // Set properties before the first play(), including after hydration.
  video.muted = video.defaultMuted = true;
  video.playsInline = true;

  const fallback = (reason: Fallback) => {
    video.dataset.playback = reason ?? (video.paused ? 'ready' : 'playing');
    if (reason !== currentFallback) {
      currentFallback = reason;
      onFallback(reason);
    }
  };
  const recover = (reload: boolean) => {
    if (disposed || blocked || retry) return;
    if (retries >= 2) {
      blocked = true;
      fallback('error');
      return;
    }
    retry = setTimeout(() => {
      retry = undefined;
      if (disposed || document.hidden) return;
      retries++;
      if (reload) video.load();
      play();
    }, 750 * (retries + 1));
  };
  const play = () => {
    if (disposed || !wanted || document.hidden || blocked || pending || retry || !video.paused) return;
    if (video.error) {
      recover(true);
      return;
    }
    pending = true;
    void video.play().catch((error: unknown) => {
      if (disposed || !wanted || document.hidden) return;
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError') {
        blocked = true;
        // Reset to the poster; the native play control can request a user gesture.
        video.load();
        fallback('blocked');
      } else {
        if (name !== 'AbortError') fallback('error');
        recover(name !== 'AbortError');
      }
    }).finally(() => { pending = false; });
  };
  const ready = () => {
    if (!blocked && !video.error) fallback(null);
    play();
  };
  const playing = () => {
    blocked = false;
    fallback(null);
    video.dataset.playback = 'playing';
  };
  const failed = () => { fallback('error'); recover(true); };
  const visibility = () => {
    if (document.hidden) video.pause();
    else if (video.error) recover(true);
    else play();
  };
  const online = () => {
    if (video.error) { blocked = false; retries = 0; recover(true); }
  };
  video.addEventListener('loadeddata', ready);
  video.addEventListener('canplay', ready);
  video.addEventListener('playing', playing);
  video.addEventListener('error', failed);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pageshow', visibility);
  window.addEventListener('online', online);
  return {
    setPlaying(playing: boolean) {
      wanted = playing;
      if (wanted) play(); else video.pause();
    },
    dispose() {
      disposed = true;
      clearTimeout(retry);
      video.pause();
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('canplay', ready);
      video.removeEventListener('playing', playing);
      video.removeEventListener('error', failed);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pageshow', visibility);
      window.removeEventListener('online', online);
    },
  };
}
