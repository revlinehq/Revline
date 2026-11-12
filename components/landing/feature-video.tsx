'use client';
import { useLandingAutoplay } from './autoplay';

/** A feature card's film, made in Revline: plays muted and looping while on screen. */
export function LandingFeatureVideo({ src, poster }: { src: string; poster: string }) {
  const ref = useLandingAutoplay();
  return <video ref={ref} className="landing-feature-film" src={src} poster={poster} controls muted loop playsInline preload="metadata" />;
}
