'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

/** A marquee tile's film: plays muted and looping while on screen, held on its poster when motion is reduced.
 *  Clicking it opens the film larger in a modal sized to its `ratio`, muted at first, with the browser's own controls to unmute. */
export function LandingTileVideo({ src, poster, label, ratio = 16 / 9, hidden = false }: { src: string; poster: string; label: string; ratio?: number; hidden?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [open, setOpen] = useState(false);
  // The modal sizes to the film's real frame once its metadata loads; `ratio` only covers the first paint.
  const [frame, setFrame] = useState(ratio);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    // Server-rendered HTML can't carry `muted`, so set it before asking to play.
    element.muted = true;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // The browser can leave a film "playing" with its clock stuck; a small seek wakes it, as in the Motion section.
    let watch = 0;
    const stop = () => { clearInterval(watch); watch = 0; element.pause(); };
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || open) { stop(); return; }
      void element.play().catch(() => {});
      if (watch) return;
      let last = -1;
      watch = window.setInterval(() => {
        if (element.paused) void element.play().catch(() => {});
        else if (element.currentTime === last) element.currentTime = last + .01;
        last = element.currentTime;
      }, 1000);
    });
    observer.observe(element);
    return () => { observer.disconnect(); clearInterval(watch); };
  }, [open]);
  return <Dialog open={open} onOpenChange={setOpen}>
    <button type="button" className="landing-tile-play" onClick={() => setOpen(true)} tabIndex={hidden ? -1 : undefined} aria-label={`Play ${label}`}>
      <video ref={video} src={src} poster={poster} muted loop playsInline preload="metadata" />
    </button>
    <DialogContent className="landing-video-modal" style={{ '--video-ratio': frame } as CSSProperties}>
      <DialogTitle className="sr-only">{label}</DialogTitle>
      <video src={src} poster={poster} muted autoPlay controls playsInline onLoadedMetadata={event => { const { videoWidth, videoHeight } = event.currentTarget; if (videoWidth && videoHeight) setFrame(videoWidth / videoHeight); }} />
    </DialogContent>
  </Dialog>;
}
