import Link from 'next/link';
import { Download, Film } from 'lucide-react';
import { Brand } from '@/components/workspace/brand';
import { PrimaryButton } from '@/components/workspace/primary-button';
import { LANDING_DEMO_ASSETS } from './assets';

function WorkflowCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <article className="landing-workflow-card"><div className="landing-workflow-visual">{children}</div><div className="landing-workflow-copy"><h3>{title}</h3><p>{description}</p></div></article>;
}

export function Workflow({ heading = 'How it works.' }: { heading?: string } = {}) {
  return <section id="workflow" className="landing-workflow landing-section" aria-labelledby="landing-workflow-heading">
    <h2 id="landing-workflow-heading">{heading}</h2>
    <div className="landing-workflow-grid">
      <WorkflowCard title="Bring your clips." description="Start with the footage you already have.">
        <div className="landing-workflow-footage">{[LANDING_DEMO_ASSETS.portrait, LANDING_DEMO_ASSETS.coffee, LANDING_DEMO_ASSETS.portrait].map((src, index) => <img src={src} alt={index === 1 ? 'A morning in a coffee shop' : 'A weekend outside'} width={100} height={150} loading="lazy" key={index} />)}</div>
        <div className="landing-workflow-files"><Film size={14} aria-hidden="true" /><span>weekend.mov · coffee.mov · +4 clips</span></div>
      </WorkflowCard>
      <WorkflowCard title="Describe your edit." description="Tell Revline the direction. Review what changes.">
        <div className="landing-workflow-request">Give it a stronger opening.<br />Keep the captions clean.</div>
        <div className="landing-workflow-answer"><div><Brand markOnly /><strong>Revline</strong></div><p>Opening tightened.<br />Captions added.</p></div>
      </WorkflowCard>
      <WorkflowCard title="Finish your version." description="Adjust the details, check the preview, and export.">
        <div className="landing-workflow-film"><img src={LANDING_DEMO_ASSETS.portrait} alt="A finished portrait video with an opening title" width={108} height={192} loading="lazy" /><strong>MAKE ROOM<br />FOR OUTSIDE.</strong></div>
        <div className="landing-workflow-export"><span>Your edit, ready.</span><PrimaryButton asChild size="compact" className="landing-workflow-export-button"><Link href="/sign-in">Export video<Download size={12} aria-hidden="true" /></Link></PrimaryButton></div>
      </WorkflowCard>
    </div>
  </section>;
}
