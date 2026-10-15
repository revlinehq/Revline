import { Check, Download, Film } from 'lucide-react';
import { Brand } from '@/components/workspace/brand';
import { WorkflowVideo } from './workflow-video';

const shots = [
  { src: '/demo/landing/nasa-shot-1.webp', name: 'Countdown', file: 'countdown.mp4' },
  { src: '/demo/landing/nasa-shot-2.webp', name: 'Liftoff', file: 'liftoff.mp4' },
  { src: '/demo/landing/nasa-shot-3.webp', name: 'The climb', file: 'the-climb.mp4' },
];

function WorkflowCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <article className="landing-workflow-card"><div className="landing-workflow-visual">{children}</div><div className="landing-workflow-copy"><h3>{title}</h3><p>{description}</p></div></article>;
}

export function Workflow({ heading = 'How it works.' }: { heading?: string } = {}) {
  return <section id="workflow" className="landing-workflow landing-section" aria-labelledby="landing-workflow-heading">
    <h2 id="landing-workflow-heading">{heading}</h2>
    <div className="landing-workflow-grid">
      <WorkflowCard title="Bring your clips." description="Video, audio and images. One place to start.">
        <div className="landing-workflow-footage">{shots.map(shot => <figure key={shot.src}><img src={shot.src} alt={`NASA ${shot.name.toLowerCase()} footage`} width={100} height={150} loading="lazy" /><figcaption>{shot.file}</figcaption></figure>)}</div>
        <div className="landing-workflow-files"><Film size={14} aria-hidden="true" /><span>Your footage. Ready for the timeline.</span></div>
      </WorkflowCard>
      <WorkflowCard title="Describe your edit." description="Find the moments. Shape the cuts, text and motion.">
        <div className="landing-workflow-request">Make a space short. Open on the launch and add a bold animated title.</div>
        <div className="landing-workflow-answer"><div><Brand markOnly /><strong>Revline</strong></div><ul>{['Launch selected', 'Shots trimmed and arranged', 'Opening title animated'].map(step => <li key={step}><Check size={13} aria-hidden="true" />{step}</li>)}</ul></div>
      </WorkflowCard>
      <WorkflowCard title="Finish your version." description="Fine-tune the details. Preview, then export.">
        <div className="landing-workflow-film" role="img" aria-label="NASA footage with an opening title"><WorkflowVideo src="/demo/landing/nasa.mp4" poster="/demo/landing/nasa-shot-2.webp" /><strong>BEYOND<br />THE EVERYDAY.</strong><span className="landing-workflow-format">9:16</span></div>
        <div className="landing-workflow-export"><span>Your edit, ready.</span><span className="landing-workflow-export-button" aria-hidden="true">Export video<Download size={12} /></span></div>
      </WorkflowCard>
    </div>
  </section>;
}
