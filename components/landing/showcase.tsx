import { ArrowUpRight, Film } from 'lucide-react';

type ShowcaseExample = { title: string; src?: string; poster?: string; timelineHref?: string };
const shortForm: ShowcaseExample[] = Array.from({ length: 4 }, (_, index) => ({ title: `Short-form edit ${index + 1}` }));
const visualEffects: ShowcaseExample = { title: 'Visual effects edit' };

function ShowcaseCard({ example, wide = false }: { example: ShowcaseExample; wide?: boolean }) {
  return <figure className={`landing-showcase-example${wide ? ' is-wide' : ''}`} aria-label={example.title}>
    <div className="landing-showcase-video">
      {example.src ? <video src={example.src} poster={example.poster} aria-label={example.title} controls playsInline preload="none" /> : <div className="landing-showcase-placeholder"><Film size={22} strokeWidth={1.5}/><span>Showcase coming soon</span></div>}
    </div>
    <figcaption>
      {example.timelineHref ? <a href={example.timelineHref}>View timeline<ArrowUpRight size={14}/></a> : <span className="landing-showcase-pending" aria-label="Timeline not published yet">View timeline<ArrowUpRight size={14}/></span>}
    </figcaption>
  </figure>;
}

export function LandingShowcase() {
  return <section className="landing-showcase landing-section" aria-label="Edits made with Revline">
    <h2 className="landing-showcase-heading">Edited with Revline</h2>
    <div className="landing-showcase-group" aria-labelledby="landing-short-form-heading">
      <h3 id="landing-short-form-heading">Short-form content</h3>
      <div className="landing-showcase-grid">{shortForm.map(example => <ShowcaseCard key={example.title} example={example}/>)}</div>
    </div>
    <div className="landing-showcase-group" aria-labelledby="landing-visual-effects-heading">
      <h3 id="landing-visual-effects-heading">Visual effects</h3>
      <ShowcaseCard example={visualEffects} wide/>
    </div>
  </section>;
}
