import type { ReactNode } from 'react';
import { ArrowUp, Clapperboard, Folder, Mic, Paperclip, Youtube } from 'lucide-react';

const uploads = [
  { name: 'Raw interview.mp4', meta: '2.1 GB · 1h 32m', icon: Clapperboard, progress: 'done' },
  { name: 'B-roll / studio', meta: '48 clips', icon: Folder, progress: 'b-roll' },
  { name: 'youtu.be/x7Kd…', meta: 'Importing', icon: Youtube, progress: 'link' },
] as const;

const tracks = [
  { label: 'Video', clips: [['video', 150], ['cut', 28], ['video', 210], ['video', 0]] },
  { label: 'Captions', clips: [['caption', 90], ['caption', 120], ['caption', 80], ['caption', 200]] },
  { label: 'Audio', clips: [['audio', 0]] },
] as const;

function Card({ title, description, className, children }: { title: string; description: string; className: string; children: ReactNode }) {
  return <article className={`landing-bento-card ${className}`}>
    <div className="landing-bento-visual">{children}</div>
    <div className="landing-bento-text"><h3>{title}</h3><p>{description}</p></div>
  </article>;
}

export function LandingHowItWorks() {
  return <section id="how-it-works" className="landing-how landing-section" aria-labelledby="landing-how-heading">
    <h2 id="landing-how-heading">Raw footage in. Finished video out.</h2>
    <div className="landing-bento">
      <div className="landing-bento-row landing-bento-row-top">
        <Card className="landing-bento-upload" title="Drop in anything" description="Raw files, a whole folder of b-roll, or a YouTube link. Hours of footage is fine.">
          <ul className="landing-upload-panel" aria-hidden="true">{uploads.map(({ name, meta, icon: Icon, progress }) => <li key={name}>
            <span className="landing-upload-icon"><Icon size={16} /></span>
            <div><div className="landing-upload-top"><strong>{name}</strong><span>{meta}</span></div><span className="landing-progress" data-progress={progress}><span /></span></div>
          </li>)}</ul>
        </Card>
        <Card className="landing-bento-prompt" title="Say what you want" description="Plain English. No keyframes, no menus, no tutorials.">
          <div className="landing-prompt-panel" aria-hidden="true">
            <p>Tighten it to 60 seconds, punchier pacing, captions in our brand font.</p>
            <div><span><Paperclip size={16} /><Mic size={16} /></span><span className="landing-prompt-send"><ArrowUp size={15} /></span></div>
          </div>
        </Card>
      </div>
      <div className="landing-bento-row landing-bento-row-bottom">
        <Card className="landing-bento-timeline" title="Every edit stays editable" description="The agent works on a real timeline. Nudge a cut, swap a clip, undo anything.">
          <div className="landing-timeline-panel" aria-hidden="true">
            <div className="landing-edit-notes"><span data-tone="cut">Cut 3.2s silence</span><span data-tone="caption">Added caption</span><span data-tone="zoom">Zoom on speaker</span></div>
            <div className="landing-tracks">
              {tracks.map(({ label, clips }) => <div key={label} className="landing-track"><span>{label}</span>{clips.map(([kind, width], index) => <i key={index} data-kind={kind} style={width ? { width } : { flex: 1 }} />)}</div>)}
              <span className="landing-playhead" />
            </div>
          </div>
        </Card>
        <Card className="landing-bento-formats" title="Export for every feed" description="One edit, every format. Straight to your drive or socials.">
          <div className="landing-formats" aria-hidden="true">{['9:16', '1:1', '16:9'].map(ratio => <span key={ratio} data-ratio={ratio}>{ratio}</span>)}</div>
        </Card>
      </div>
    </div>
  </section>;
}
