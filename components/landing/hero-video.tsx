'use client';
import { useEffect, useRef } from 'react';

// Revline's launch film, made in Revline from two screenshots. A 1080p web copy of the 4K master.
const FILM_SRC = '/landing/revline-launch.mp4';
const FILM_POSTER = '/landing/revline-launch-poster.webp';

/** The hero film: plays muted while on screen, pauses off screen, and waits for a tap when motion is reduced. */
export function LandingHeroVideo() {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    // Server-rendered HTML can't carry `muted`, so set it before asking to play.
    element.muted = true;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (calm) element.controls = true;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) element.pause();
      else if (!calm) void element.play().catch(() => {});
    }, { threshold: .25 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <video ref={video} className="landing-product-window" src={FILM_SRC} poster={FILM_POSTER} width={1920} height={1080} muted loop playsInline preload="metadata" aria-label="Revline's launch film, made in Revline from two screenshots" />;
}
