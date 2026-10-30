'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

/** A marquee tile's film: plays muted and looping while on screen, held on its poster when motion is reduced.
 *  Clicking it opens the film larger in a modal sized to its `ratio`, muted at first, with the browser's own controls to unmute. */
export function LandingTileVideo({ src, poster, label, ratio = 16 / 9, hidden = false }: { src: string; poster: string; label: string; ratio?: number; hidden?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    // Server-rendered HTML can't carry `muted`, so set it before asking to play.
    element.muted = true;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !open) void element.play().catch(() => {}); else element.pause();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);
  return <Dialog open={open} onOpenChange={setOpen}>
    <button type="button" className="landing-tile-play" onClick={() => setOpen(true)} tabIndex={hidden ? -1 : undefined} aria-label={`Play ${label}`}>
      <video ref={video} src={src} poster={poster} muted loop playsInline preload="metadata" />
    </button>
    <DialogContent className="landing-video-modal" style={{ '--video-ratio': ratio } as CSSProperties}>
      <DialogTitle className="sr-only">{label}</DialogTitle>
      <video src={src} poster={poster} muted autoPlay controls playsInline />
    </DialogContent>
  </Dialog>;
}
