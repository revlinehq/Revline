'use client';
import { useEffect, useRef } from 'react';

/** A marquee tile's film: plays muted and looping while on screen, held on its poster when motion is reduced. */
export function LandingTileVideo({ src, poster }: { src: string; poster: string }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    // Server-rendered HTML can't carry `muted`, so set it before asking to play.
    element.muted = true;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void element.play().catch(() => {}); else element.pause();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <video ref={video} src={src} poster={poster} muted loop playsInline preload="metadata" />;
}
