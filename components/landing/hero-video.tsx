'use client';
import { useLandingVideoPlayback } from './use-video-playback';

// Revline's launch film, made in Revline from two screenshots. A 1080p web copy of the 4K master.
const FILM_SRC = '/landing/revline-launch.mp4';
const FILM_POSTER = '/landing/revline-launch-poster.webp';

/** The hero film: plays muted while on screen, pauses off screen, and waits for a tap when motion is reduced. */
export function LandingHeroVideo() {
  const video = useLandingVideoPlayback(FILM_SRC);
  return <video ref={video} className="landing-product-window" src={FILM_SRC} poster={FILM_POSTER} width={1920} height={1080} muted loop playsInline preload="none" aria-label="Revline's launch film, made in Revline from two screenshots" />;
}
