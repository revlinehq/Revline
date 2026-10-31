'use client';
import { useEffect, useRef } from 'react';

/**
 * A How it works step's film: held on its first frame until the pointer is over it, then plays muted and looping,
 * and freezes where it is when the pointer leaves. Touch screens have no hover, so there it plays while on screen.
 * Held on its poster when motion is reduced.
 */
export function LandingStepVideo({ src, poster }: { src: string; poster: string }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    // Server-rendered HTML can't carry `muted`, so set it before asking to play.
    element.muted = true;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (matchMedia('(hover: hover)').matches) {
      const play = () => void element.play().catch(() => {}), pause = () => element.pause();
      element.addEventListener('pointerenter', play);
      element.addEventListener('pointerleave', pause);
      return () => { element.removeEventListener('pointerenter', play); element.removeEventListener('pointerleave', pause); };
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void element.play().catch(() => {}); else element.pause();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <video ref={video} src={src} poster={poster} muted loop playsInline preload="metadata" />;
}
