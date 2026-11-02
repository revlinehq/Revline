'use client';
import { useLandingVideoPlayback } from './use-video-playback';

/** A feature card's film, made in Revline: plays muted and looping while on screen, held on its poster when motion is reduced. */
export function LandingFeatureVideo({ src, poster }: { src: string; poster: string }) {
  const video = useLandingVideoPlayback(src);
  return <video ref={video} className="landing-feature-film" src={src} poster={poster} muted loop playsInline preload="none" />;
}
