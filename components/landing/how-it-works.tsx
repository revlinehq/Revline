import type { ReactNode } from 'react';
import { ArrowUp, Clapperboard, Folder, Mic, Paperclip, Youtube } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LandingChip, LandingHeading, LandingSection } from './ui';

const uploads = [
  { name: 'Raw interview.mp4', meta: '2.1 GB · 1h 32m', icon: Clapperboard, progress: 'done' },
  { name: 'B-roll / studio', meta: '48 clips', icon: Folder, progress: 'b-roll' },
  { name: 'youtu.be/x7Kd…', meta: 'Importing', icon: Youtube, progress: 'link' },
] as const;

const editNotes = [['cut', 'Cut 3.2s silence'], ['caption', 'Added caption'], ['zoom', 'Zoom on speaker']] as const;

const tracks = [
  { label: 'Video', clips: [['video', 150], ['cut', 28], ['video', 210], ['video', 0]] },
  { label: 'Captions', clips: [['caption', 90], ['caption', 120], ['caption', 80], ['caption', 200]] },
  { label: 'Audio', clips: [['audio', 0]] },
] as const;

function Card({ title, description, className, children }: { title: string; description: string; className: string; children: ReactNode }) {
  return <article className={cn('landing-bento-card', className)}>
    <div className="landing-bento-visual">{children}</div>
    <div className="landing-bento-text"><h3>{title}</h3><p>{description}</p></div>
  </article>;
}

export function LandingHowItWorks() {
  return <LandingSection id="how-it-works" className="landing-how" headingId="landing-how-heading">
    <LandingHeading id="landing-how-heading" title="Raw footage in. Finished video out." />
    <div className="landing-bento">
      <div className="landing-bento-row landing-bento-row-top">
        <Card className="landing-bento-upload" title="Drop in anything" description="Raw files, a whole folder of b-roll, or a YouTube link. Hours of footage is fine.">
          <ul className="landing-panel landing-upload-panel" aria-hidden="true">{uploads.map(({ name, meta, icon: Icon, progress }) => <li key={name}>
            <span className="landing-upload-icon"><Icon size={16} /></span>
            <div><div className="landing-upload-top"><strong>{name}</strong><span>{meta}</span></div><span className="landing-progress" data-progress={progress}><span /></span></div>
          </li>)}</ul>
        </Card>
        <Card className="landing-bento-prompt" title="Say what you want" description="Plain English. No keyframes, no menus, no tutorials.">
          <div className="landing-panel landing-prompt-panel" aria-hidden="true">
            <p>Tighten it to 60 seconds, punchier pacing, captions in our brand font.</p>
            <div><span><Paperclip size={16} /><Mic size={16} /></span><span className="landing-prompt-send"><ArrowUp size={15} /></span></div>
          </div>
        </Card>
      </div>
      <div className="landing-bento-row landing-bento-row-bottom">
        <Card className="landing-bento-timeline" title="Every edit stays editable" description="The agent works on a real timeline. Nudge a cut, swap a clip, undo anything.">
          <div className="landing-panel landing-timeline-panel" aria-hidden="true">
            <div className="landing-edit-notes">{editNotes.map(([tone, label]) => <LandingChip key={label} tone={tone}>{label}</LandingChip>)}</div>
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
  </LandingSection>;
}
