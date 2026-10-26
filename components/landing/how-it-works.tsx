import type { ReactNode } from 'react';
import { ArrowUp, Download, MousePointer2, Paperclip, Upload } from 'lucide-react';
import { LandingHeading, LandingSection } from './ui';

function Way({ title, description, image, children }: { title: string; description: string; image: string; children: ReactNode }) {
  return <article className="landing-way">
    <div className="landing-way-text"><h3>{title}</h3><p>{description}</p></div>
    <div className="landing-way-visual" style={{ backgroundImage: `url(/landing/how/${image}.webp)` }} aria-hidden="true">{children}</div>
  </article>;
}

export function LandingHowItWorks() {
  return <LandingSection id="how-it-works" className="landing-how" headingId="landing-how-heading">
    <LandingHeading id="landing-how-heading" title="Raw footage in. Finished video out." />
    <div className="landing-ways">
      <Way title="Upload your footage" description="Drop in raw clips, a folder of b-roll or a YouTube link. Revline sorts and understands every frame." image="upload">
        <div className="landing-way-panel landing-way-upload"><div>
          <Upload size={18} />
          <strong>Upload footage</strong>
          <span>Drag and drop files to start editing</span>
        </div></div>
      </Way>
      <Way title="Edit by prompting" description="Say what you want in plain words. Revline cuts, captions and polishes while you watch." image="prompt">
        <div className="landing-way-panel landing-way-prompt">
          <span>Describe the edit you want</span>
          <div><i><Paperclip size={14} /></i><i data-send><ArrowUp size={14} /></i></div>
        </div>
      </Way>
      <Way title="Let your agent run it" description="Connect any MCP client and let your agent handle the whole edit, start to finish." image="agent">
        <div className="landing-way-panel landing-way-agent">
          <code>{'> revline.edit_video(\'ep12.mp4\')'}</code>
          <code data-muted>{'  removing silences…'}</code>
          <code data-muted>{'  adding captions…'}</code>
          <code data-done>✓ Done in 42s</code>
        </div>
      </Way>
      <Way title="Export everywhere" description="One edit, every format. Ship 9:16, 1:1 and 16:9 straight to your socials." image="export">
        <div className="landing-way-export">
          <span className="landing-way-panel"><Download size={14} />Export video</span>
          <MousePointer2 size={18} fill="currentColor" />
        </div>
      </Way>
    </div>
  </LandingSection>;
}
