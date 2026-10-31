'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { LandingSection } from './ui';

type Kind = { id: string; label: string; image: string; overlay: ReactNode; film?: Film };
// A segment can show a real film instead of a still; it plays on its own, muted and looping, while its tab shows.
type Film = { src: string; poster: string };

// Each segment swaps the preview: its footage and its motion overlay.
const kinds: Kind[] = [
  {
    // Revline's own launch film, made in Revline from two screenshots; its titles are in the film, so no overlay.
    id: 'launch', label: 'Launch videos', image: 'vlog',
    overlay: null,
    film: { src: '/landing/revline-launch.mp4', poster: '/landing/revline-launch-poster.webp' },
  },
  {
    id: 'explainers', label: 'Explainers', image: 'code-screen',
    overlay: <p className="landing-motion-title">Complex ideas,<br /><b>made simple.</b></p>,
  },
  {
    // A Jensen Huang interview moment with blueprint motion graphics, made in Revline; its graphics are in the film.
    id: 'elements', label: 'Motion elements', image: 'talking-head',
    overlay: null,
    film: { src: '/landing/jensen-motion.mp4', poster: '/landing/jensen-motion-poster.webp' },
  },
];
// Scroll distance each segment holds the pinned section for, in viewport heights.
const SCROLL_PER_SEGMENT = .7;

/** The film behind a segment: plays from the start, muted and looping, while its tab shows and the section is on screen. */
function FilmScene({ film, playing }: { film: Film; playing: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    // Server-rendered HTML can't carry `muted`, so set it before asking to play.
    element.muted = true;
    if (!playing) { element.pause(); return; }
    // Each time its tab opens the film starts over; a fresh seek also wakes a video the browser left stalled while it was invisible.
    element.currentTime = 0;
    void element.play().catch(() => {});
  }, [playing]);
  return <video ref={video} className="landing-motion-film" src={film.src} poster={film.poster} muted loop playsInline preload="metadata" />;
}

export function LandingMotion() {
  const [active, setActive] = useState(0);
  const [onScreen, setOnScreen] = useState(false);
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
  // There is no timer: it only switches when the scroll-picked segment changes, so a clicked tab stays put
  // until the visitor scrolls into another segment.
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

  // Films play only while the section is on screen.
  useEffect(() => {
    const node = pin.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: .25 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

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
        {kinds.map((item, index) => <div key={item.id} className="landing-motion-scene" data-active={index === active || undefined} style={item.film ? undefined : { backgroundImage: `url(/landing/${item.image}.webp)` }} aria-hidden={index !== active}>
          {item.film ? <FilmScene film={item.film} playing={index === active && onScreen} /> : <div className="landing-motion-shade">{item.overlay}</div>}
        </div>)}
      </div>
    </div>
  </LandingSection>;
}
