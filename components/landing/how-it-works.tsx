import type { ReactNode } from 'react';
import { ArrowUp, Download, Film, Plus } from 'lucide-react';
import { LandingHeading, LandingSection } from './ui';

// Positions follow the design's 357px-wide visual; x and width scale with the card.
const clips = [
  { src: 'clip1', length: '0:42', x: 8, y: 14, w: 156, h: 100, rotate: 4 },
  { src: 'clip2', length: '1:18', x: 196, y: 44, w: 153, h: 100, rotate: -5 },
  { src: 'clip3', length: '0:27', x: 22, y: 132, w: 150, h: 96, rotate: -3 },
  { src: 'clip4', length: '2:05', x: 150, y: 168, w: 165, h: 104, rotate: 3 },
] as const;
const pct = (value: number) => `${(value / 357) * 100}%`;

function Step({ number, word, title, description, children }: { number: string; word: string; title: string; description: string; children: ReactNode }) {
  return <article className="landing-step">
    <p className="landing-step-word"><span>{number}</span>{word}</p>
    <div className="landing-step-visual" aria-hidden="true">{children}</div>
    <div className="landing-step-text"><h3>{title}</h3><p>{description}</p></div>
  </article>;
}

export function LandingHowItWorks() {
  return <LandingSection id="how-it-works" className="landing-how" headingId="landing-how-heading">
    <LandingHeading id="landing-how-heading" title="From raw clips to a finished cut." />
    <div className="landing-steps">
      <Step number="01" word="Drop" title="Bring your footage" description="Raw clips, b-roll or a YouTube link. Revline reads every frame before it cuts.">
        <div className="landing-step-drop">
          {clips.map(clip => <span key={clip.src} className="landing-step-clip" style={{ left: pct(clip.x), top: clip.y, width: pct(clip.w), height: clip.h, rotate: `${clip.rotate}deg`, backgroundImage: `url(/landing/how/${clip.src}.webp)` }}>
            <span><Film size={11} />{clip.length}</span>
          </span>)}
          <div className="landing-step-upload">
            <div><span>podcast_ep12.mp4</span><span>62%</span></div>
            <i><b /></i>
          </div>
        </div>
      </Step>
      <Step number="02" word="Prompt" title="Tell it what you want" description="Plain words in, real edits out. Watch each step land on the timeline.">
        <div className="landing-step-prompt">
          <p className="landing-step-message">Make this a 60s TikTok with captions in our font</p>
          <div className="landing-step-agent"><p>Trimming to 0:58 and picking the strongest hook.</p><p>Captions added in Brand Sans.</p></div>
          <div className="landing-step-box">
            <span>What would you change next?</span>
            <div><Plus size={16} /><i><ArrowUp size={14} /></i></div>
          </div>
        </div>
      </Step>
      <Step number="03" word="Post" title="Post it anywhere" description="One edit, every format. Sized for TikTok, Reels and Shorts.">
        <div className="landing-step-post">
          <span className="landing-step-video" />
          <span className="landing-step-export">Export<Download size={14} /></span>
          <span className="landing-step-formats"><b>9:16</b><span>1:1</span><span>16:9</span></span>
        </div>
      </Step>
    </div>
  </LandingSection>;
}
