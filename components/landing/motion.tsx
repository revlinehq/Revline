import { Diamond } from 'lucide-react';
import { LandingSection } from './ui';

// The kinds of motion Revline makes; the first is shown in the preview.
const kinds = [
  { title: 'Launch videos', description: 'A real product launch, cut and animated entirely in Revline.' },
  { title: 'Explainers' },
  { title: 'Motion elements' },
  { title: 'Product demos' },
];
const words = ['Every', 'word', 'lands', 'on time.'];

export function LandingMotion() {
  return <LandingSection id="motion" className="landing-motion" headingId="landing-motion-heading">
    <header className="landing-motion-heading">
      <h2 id="landing-motion-heading">Motion that keeps them watching.</h2>
      <p>Launch videos, explainers and motion that pops in as you talk, all edited in Revline.</p>
    </header>
    <div className="landing-motion-showcase">
      <ol className="landing-motion-list">{kinds.map((kind, index) => <li key={kind.title} data-active={index === 0 || undefined}>
        <i><b /></i>
        <div><span>{String(index + 1).padStart(2, '0')}</span><h3>{kind.title}</h3></div>
        {index === 0 && kind.description && <p>{kind.description}</p>}
      </li>)}</ol>
      <div className="landing-motion-preview" aria-hidden="true">
        <div className="landing-motion-shade">
          <div className="landing-motion-top"><span><i />Launch video</span><time>00:03:12</time></div>
          <p className="landing-motion-title">Every word<br /><b>lands</b> <span>on time.</span></p>
          <div className="landing-motion-timeline">
            <div>{words.map(word => <span key={word}>{word}</span>)}</div>
            <div>{words.map((word, index) => <Diamond key={word} size={12} data-pending={index === 3 || undefined} />)}</div>
            <i><b /></i>
          </div>
        </div>
      </div>
    </div>
  </LandingSection>;
}
