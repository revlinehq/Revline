/** A feature card's film, made in Revline: rests on its poster and plays only when the visitor presses play. */
export function LandingFeatureVideo({ src, poster }: { src: string; poster: string }) {
  return <video className="landing-feature-film" src={src} poster={poster} controls muted loop playsInline preload="none" />;
}
