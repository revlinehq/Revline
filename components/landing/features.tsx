'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LANDING_DEMO_ASSETS } from './assets';
import './feature-scroll.css';

const features = [
  { id: 'titles', label: 'Titles in motion', description: 'Give your opening a little presence. Add a title, choose how it moves, and shape the timing until it feels like you.' },
  { id: 'moments', label: 'Find the moments', description: 'Find a stronger opening in your footage, then turn it into a tighter sequence. Keep the moments that move your story forward.' },
  { id: 'beats', label: 'Cut to the beat', description: 'Bring your music into the edit. Match shot changes to its rhythm, then refine the pace without losing the story.' },
  { id: 'subject', label: 'Keep the subject in frame', description: 'Make a wide shot work in a smaller frame. Follow the visible subject and adjust the crop as the shot moves.' },
  { id: 'captions', label: 'Captions that follow', description: 'Turn speech into timed captions. Change the words, style, and placement in chat, with every line still yours to edit.' },
] as const;

type FeatureId = typeof features[number]['id'];
const waveform = [16, 27, 19, 36, 48, 30, 18, 42, 57, 38, 22, 31, 46, 60, 40, 25, 18, 34, 52, 42, 24, 35, 57, 44, 27, 18, 32, 48, 38, 20, 28, 15];

function FeaturePreview({ kind }: { kind: FeatureId }) {
  return <figure className={`landing-features-preview landing-features-preview-${kind}`} aria-label={`Illustrative preview: ${features.find(feature => feature.id === kind)!.label}`}>
    <Image src={LANDING_DEMO_ASSETS.portrait} alt="A skater with a yellow skateboard outside" fill sizes="(max-width: 760px) calc(100vw - 40px), (max-width: 1100px) 65vw, 780px" unoptimized loading="lazy" className="landing-features-image" />
    <div className="landing-features-shade" aria-hidden="true" />
    {kind === 'titles' ? <div className="landing-features-motion" aria-hidden="true"><span>A little outside.</span><strong>SMALL PLANS.<br /><em>BIG WEEKENDS.</em></strong></div> : null}
    {kind === 'moments' ? <div className="landing-features-moments" aria-hidden="true"><span className="landing-features-moments-title">The moments worth keeping.</span><div className="landing-features-shot-cards">{[LANDING_DEMO_ASSETS.coffee, LANDING_DEMO_ASSETS.portrait, LANDING_DEMO_ASSETS.coffee].map((src, index) => <div className={`landing-features-shot ${index === 1 ? 'landing-features-shot-selected' : ''}`} key={index}><Image src={src} alt="" fill sizes="220px" unoptimized loading="lazy" /><span>{['01 · The slow start', '02 · Step outside', '03 · Stay a while'][index]}</span>{index === 1 ? <small>Opening</small> : null}</div>)}</div></div> : null}
    {kind === 'beats' ? <div className="landing-features-beats" aria-hidden="true"><strong>Find your rhythm.</strong><div className="landing-features-beat-strip"><div className="landing-features-waveform">{waveform.map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}</div>{[18, 38, 61, 82].map(left => <i key={left} style={{ left: `${left}%` }} />)}<span className="landing-features-beat-label">Every cut, in time.</span></div></div> : null}
    {kind === 'subject' ? <div className="landing-features-reframe" aria-hidden="true"><span className="landing-features-portrait-frame"><span>9:16</span></span><span className="landing-features-subject-box" /><span className="landing-features-reframe-label">Same story. A closer frame.</span></div> : null}
    {kind === 'captions' ? <div className="landing-features-captions" aria-hidden="true"><span>A little more <strong>outside.</strong></span><span>A little less on your phone.</span></div> : null}
  </figure>;
}

export function LandingFeatures() {
  const [active, setActive] = useState<FeatureId>('titles');
  const [scrollDriven, setScrollDriven] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const rail = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const activeRef = useRef<FeatureId>('titles');
  const geometry = useRef<{ top: number; range: number } | null>(null);
  const keyboardInput = useRef(false);

  useEffect(() => {
    const track = rail.current, content = stage.current;
    if (!track || !content) return;
    // Reduced motion removes the preview transition, not the scroll interaction.
    const eligible = window.matchMedia('(min-width: 901px)');
    let frame = 0;
    const update = () => {
      frame = 0;
      const metrics = geometry.current;
      if (!metrics) return;
      const progress = (metrics.top - track.getBoundingClientRect().top) / metrics.range;
      const index = Math.max(0, Math.min(features.length - 1, Math.round(progress * (features.length - 1))));
      const next = features[index].id;
      if (next !== activeRef.current) {
        activeRef.current = next;
        setKeyboard(false);
        setActive(next);
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const measure = () => {
      const height = content.offsetHeight;
      // A short viewport keeps normal tabs rather than pinning content it cannot show.
      const enabled = eligible.matches && height <= window.innerHeight - 48;
      setScrollDriven(enabled);
      if (enabled) {
        const top = Math.max(24, (window.innerHeight - height) / 2);
        const range = Math.max(280, window.innerHeight * .42) * (features.length - 1);
        geometry.current = { top, range };
        track.style.height = `${height + range}px`;
        content.style.top = `${top}px`;
        schedule();
      } else {
        geometry.current = null;
        track.style.removeProperty('height');
        content.style.removeProperty('top');
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', measure);
    eligible.addEventListener('change', measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', measure);
      eligible.removeEventListener('change', measure);
    };
  }, []);

  const selectFeature = (value: string) => {
    const index = features.findIndex(feature => feature.id === value);
    if (index < 0) return;
    activeRef.current = features[index].id;
    setKeyboard(keyboardInput.current);
    setActive(features[index].id);
    const metrics = geometry.current, track = rail.current;
    if (metrics && track) {
      // A deliberate tab selection moves to that scroll segment, preserving its selection
      // when the next scroll event arrives. Native wheel/touch scrolling is never intercepted.
      const start = window.scrollY + track.getBoundingClientRect().top - metrics.top;
      window.scrollTo({ top: start + index * metrics.range / (features.length - 1), behavior: 'instant' });
    }
  };
  const activeIndex = features.findIndex(feature => feature.id === active);

  return <section id="features" className="landing-features landing-section" aria-labelledby="landing-features-heading" data-scroll-driven={scrollDriven} data-keyboard-transition={keyboard}>
    <div className="landing-feature-scroll-rail" ref={rail}>
      <div className="landing-feature-scroll-stage" ref={stage}>
        <header className="landing-features-heading"><h2 id="landing-features-heading">Features</h2></header>
        <Tabs value={active} onValueChange={selectFeature} orientation="vertical" className="landing-features-tabs">
          <TabsList variant="line" className="landing-features-list" aria-label="Explore editing features" onPointerDownCapture={() => { keyboardInput.current = false; }} onKeyDownCapture={() => { keyboardInput.current = true; }}>{features.map(feature => <TabsTrigger value={feature.id} className="landing-features-trigger" key={feature.id}>{feature.label}</TabsTrigger>)}</TabsList>
          <div className="landing-features-panels">{features.map((feature, index) => <TabsContent forceMount value={feature.id} className="landing-features-panel" key={feature.id} data-phase={index < activeIndex ? 'before' : index > activeIndex ? 'after' : 'active'} aria-hidden={feature.id !== active} inert={feature.id !== active} tabIndex={feature.id === active ? 0 : -1}><FeaturePreview kind={feature.id} /><p>{feature.description}</p></TabsContent>)}</div>
        </Tabs>
      </div>
    </div>
  </section>;
}
