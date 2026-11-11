// Revline's product video. A 1080p web copy of the 4K master.
const FILM_SRC = '/landing/revline-launch.mp4';
const FILM_POSTER = '/landing/revline-launch-poster.webp';

/** The hero video: rests on its poster and plays only when the visitor presses play. */
export function LandingHeroVideo() {
  return <video className="landing-product-window" src={FILM_SRC} poster={FILM_POSTER} width={1920} height={1080} controls muted loop playsInline preload="none" aria-label="Revline product video" />;
}
