import type { ReactNode } from 'react';
import { ArrowUp, Clapperboard, Folder, Mic, Paperclip, Youtube } from 'lucide-react';
import { LandingChip, LandingHeading, LandingSection } from './ui';

const uploads = [
  { name: 'podcast_ep12.mp4', meta: '2.4 GB', icon: Clapperboard, fill: '90%' },
  { name: 'b-roll', meta: '38 clips', icon: Folder, fill: '63%', loading: true },
  { name: 'youtube.com/watch?v=…', meta: 'Importing', icon: Youtube, fill: '31%', loading: true },
] as const;

const editNotes = [['cut', 'Cut 3.2s silence'], ['caption', 'Added caption'], ['zoom', 'Zoom on speaker']] as const;

const tracks = [
  { label: 'Video', clips: [['video', 60], ['cut', 11], ['video', 84], ['video', 0]] },
  { label: 'Captions', clips: [['caption', 36], ['caption', 48], ['caption', 32], ['caption', 80]] },
  { label: 'Audio', clips: [['audio', 0]] },
] as const;

function Step({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <article className="landing-step">
    <div className="landing-step-visual" aria-hidden="true">{children}</div>
    <div className="landing-step-text"><h3>{title}</h3><p>{description}</p></div>
  </article>;
}

export function LandingHowItWorks() {
  return <LandingSection id="how-it-works" className="landing-how" headingId="landing-how-heading">
    <LandingHeading id="landing-how-heading" title="Raw footage in. Finished video out." />
    <div className="landing-steps">
      <Step title="Drop in anything" description="Raw files, a folder of b-roll or a YouTube link.">
        <ul className="landing-panel landing-upload-list">{uploads.map(({ name, meta, icon: Icon, fill, ...row }) => <li key={name}>
          <span className="landing-upload-icon"><Icon size={16} /></span>
          <div><div className="landing-upload-top"><strong>{name}</strong><span>{meta}</span></div>
            <span className="landing-progress" data-loading={'loading' in row || undefined}><span style={{ width: fill }} /></span></div>
        </li>)}</ul>
      </Step>
      <Step title="Say what you want" description="Plain English. No keyframes, no menus.">
        <div className="landing-panel landing-prompt-panel">
          <p>Tighten it to 60 seconds, punchier pacing, captions in our brand font.</p>
          <div><span><Paperclip size={16} /><Mic size={16} /></span><span className="landing-prompt-send"><ArrowUp size={15} /></span></div>
        </div>
      </Step>
      <Step title="Tweak and export" description="Adjust any cut on a real timeline, then export for every feed.">
        <div className="landing-panel landing-timeline-panel">
          <div className="landing-edit-notes">{editNotes.map(([tone, label]) => <LandingChip key={label} tone={tone}>{label}</LandingChip>)}</div>
          <div className="landing-tracks">
            {tracks.map(({ label, clips }) => <div key={label} className="landing-track"><span>{label}</span>{clips.map(([kind, width], index) => <i key={index} data-kind={kind} style={width ? { width } : { flex: 1 }} />)}</div>)}
            <span className="landing-playhead" />
          </div>
        </div>
      </Step>
    </div>
  </LandingSection>;
}
