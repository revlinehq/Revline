'use client';
import { useLandingAutoplay } from './autoplay';

// Revline's product video. A 1080p web copy of the 4K master.
const FILM_SRC = '/landing/revline-launch.mp4';
const FILM_POSTER = '/landing/revline-launch-poster.webp';

/** The hero video: starts muted and looping as soon as it is on screen. */
export function LandingHeroVideo() {
  const ref = useLandingAutoplay();
  return <video ref={ref} className="landing-product-window" src={FILM_SRC} poster={FILM_POSTER} width={1920} height={1080} controls muted loop playsInline preload="auto" aria-label="Revline product video" />;
}
