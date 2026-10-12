const examples: { title: string; src?: string; poster?: string }[] = [
  { title: 'Professional Edits' },
  { title: 'Short form' },
  { title: 'VFX' },
];

export function LandingShowcase() {
  return <section className="landing-showcase landing-section" aria-labelledby="landing-showcase-heading">
    <h2 id="landing-showcase-heading">made with revline</h2>
    <div className="landing-showcase-grid">
      {examples.map(example => <figure className="landing-showcase-example" key={example.title}>
        <figcaption>{example.title}</figcaption>
        <div className="landing-showcase-video">
          {example.src ? <video src={example.src} poster={example.poster} aria-label={example.title} controls playsInline preload="none" /> : <span className="sr-only">{example.title} video coming soon.</span>}
        </div>
      </figure>)}
    </div>
  </section>;
}
