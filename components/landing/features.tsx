import { AudioLines, Captions, Crop, Eraser, Layers, Scissors, Sparkles, Type } from 'lucide-react';
import { LandingHeading, LandingSection } from './ui';

const features = [
  { icon: Eraser, title: 'Background removal', description: 'Cut out people and objects without a green screen.' },
  { icon: Captions, title: 'Animated subtitles', description: 'Accurate captions in styles that match your brand.' },
  { icon: Type, title: 'Text effects', description: 'Titles, callouts and kinetic type in one line.' },
  { icon: Scissors, title: 'AI trims and cuts', description: 'Drops silences, filler words and bad takes.' },
  { icon: Sparkles, title: 'Motion design', description: 'Smooth zooms, transitions and animated graphics.' },
  { icon: Layers, title: 'Masking', description: 'Track and mask any subject, frame by frame.' },
  { icon: AudioLines, title: 'Audio cleanup', description: 'Removes noise and levels every voice.' },
  { icon: Crop, title: 'Auto reframe', description: 'Keeps the subject centered in any aspect ratio.' },
] as const;

export function LandingFeatures() {
  return <LandingSection id="features" className="landing-features" headingId="landing-features-heading">
    <LandingHeading id="landing-features-heading" title="Every tool, one prompt away" description="Ask for it in plain words. Revline handles the rest." />
    <ul className="landing-feature-grid">{features.map(({ icon: Icon, title, description }) => <li key={title}>
      <Icon size={22} aria-hidden="true" />
      <h3>{title}</h3>
      <p>{description}</p>
    </li>)}</ul>
  </LandingSection>;
}
