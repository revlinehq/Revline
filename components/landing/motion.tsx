'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Diamond, MousePointer2 } from 'lucide-react';
import { LandingSection } from './ui';

type Kind = { id: string; label: string; image: string; beats: string[]; overlay: ReactNode };

// Each segment swaps the preview: its footage, its motion overlay and the timeline beats that drive it.
const kinds: Kind[] = [
  {
    id: 'launch', label: 'Launch videos', image: 'vlog',
    beats: ['Every', 'word', 'lands', 'on time.'],
    overlay: <p className="landing-motion-title">Every word<br /><b>lands</b> <span>on time.</span></p>,
  },
  {
    id: 'explainers', label: 'Explainers', image: 'code-screen',
    beats: ['Voiceover', 'Diagram', 'Callout', 'Outro'],
    overlay: <p className="landing-motion-title">Complex ideas,<br /><b>made simple.</b></p>,
  },
  {
    id: 'elements', label: 'Motion elements', image: 'talking-head',
    beats: ['Lower third', 'Sticker', 'Zoom', 'Caption'],
    overlay: <div className="landing-motion-elements">
      <span className="landing-motion-sticker">New feature</span>
      <div className="landing-motion-lower"><b>Zura</b><span>Founder, Revline</span></div>
    </div>,
  },
  {
    id: 'demos', label: 'Product demos', image: 'product-window',
    beats: ['Click', 'Zoom in', 'Type', 'Zoom out'],
    overlay: <div className="landing-motion-demo">
      <span className="landing-motion-focus"><MousePointer2 size={22} /></span>
      <p className="landing-motion-title">Zoom follows<br /><b>the cursor.</b></p>
    </div>,
  },
];
const AUTO_ADVANCE_MS = 6000;
// Scroll distance each segment holds the pinned section for, in viewport heights.
const SCROLL_PER_SEGMENT = .7;

export function LandingMotion() {
  const [active, setActive] = useState(0);
  const [visible, setVisible] = useState(false);
  const track = useRef<HTMLElement>(null);
  const pin = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  // The white pill slides under the active segment.
  useLayoutEffect(() => {
    const measure = () => { const tab = tabs.current[active]; if (tab) setIndicator({ left: tab.offsetLeft, width: tab.offsetWidth }); };
    measure();
    addEventListener('resize', measure);
    return () => removeEventListener('resize', measure);
  }, [active]);

  // The section pins to the viewport while its tall track scrolls past; scroll position picks the segment.
  // It only switches when the scroll-picked segment changes, so clicks and the timer still work in between.
  // --enter (0 to 1) tracks the section rising into view, driving the dark panel's growth to full bleed.
  useEffect(() => {
    const node = track.current;
    if (!node) return;
    let frame = 0;
    let picked = -1;
    const update = () => {
      frame = 0;
      const box = node.getBoundingClientRect();
      node.style.setProperty('--enter', Math.min(1, Math.max(0, 1 - box.top / innerHeight)).toFixed(3));
      const range = box.height - innerHeight;
      const progress = range > 0 ? Math.min(1, Math.max(0, -box.top / range)) : 0;
      const index = Math.min(kinds.length - 1, Math.floor(progress * kinds.length));
      if (index !== picked) { picked = index; setActive(index); }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    return () => { removeEventListener('scroll', schedule); removeEventListener('resize', schedule); cancelAnimationFrame(frame); };
  }, []);

  // Advance only while the section is on screen, so visitors arrive at the first segment.
  useEffect(() => {
    const node = pin.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .35 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Always cycling: picking a segment restarts the timer from it. Reduced motion keeps the switching but drops the fades (CSS).
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setActive(index => (index + 1) % kinds.length), AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [active, visible]);

  const kind = kinds[active];
  return <LandingSection ref={track} id="motion" className="landing-motion" headingId="landing-motion-heading" data-nav-tone="dark" style={{ height: `calc(100svh + ${(kinds.length - 1) * SCROLL_PER_SEGMENT * 100}svh)` }}>
    <div ref={pin} className="landing-motion-pin">
      <header className="landing-motion-heading">
        <h2 id="landing-motion-heading">Motion that keeps them watching.</h2>
        <p>Launch videos, explainers and motion that pops in as you talk, all edited in Revline.</p>
      </header>
      <div className="landing-motion-switcher">
        <div className="landing-segments" role="tablist" aria-label="Kinds of motion">
          {indicator && <span className="landing-segments-pill" style={{ left: indicator.left, width: indicator.width }} aria-hidden="true" />}
          {kinds.map((item, index) => <button key={item.id} ref={node => { tabs.current[index] = node; }} type="button" role="tab" id={`landing-motion-tab-${item.id}`} aria-selected={index === active} aria-controls="landing-motion-panel" tabIndex={index === active ? 0 : -1}
            onClick={() => setActive(index)}
            onKeyDown={event => {
              if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
              const next = (active + (event.key === 'ArrowRight' ? 1 : kinds.length - 1)) % kinds.length;
              setActive(next); tabs.current[next]?.focus();
            }}>{item.label}</button>)}
        </div>
      </div>
      <div id="landing-motion-panel" role="tabpanel" aria-labelledby={`landing-motion-tab-${kind.id}`} className="landing-motion-preview">
        {kinds.map((item, index) => <div key={item.id} className="landing-motion-scene" data-active={index === active || undefined} style={{ backgroundImage: `url(/landing/${item.image}.webp)` }} aria-hidden={index !== active}>
          <div className="landing-motion-shade">
            <time className="landing-motion-time">00:03:12</time>
            {item.overlay}
            <div className="landing-motion-timeline">
              <div>{item.beats.map(beat => <span key={beat}>{beat}</span>)}</div>
              <div>{item.beats.map((beat, beatIndex) => <Diamond key={beat} size={12} data-pending={beatIndex === 3 || undefined} />)}</div>
              <i><b /></i>
            </div>
          </div>
        </div>)}
      </div>
    </div>
  </LandingSection>;
}
