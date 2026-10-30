'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { MousePointer2 } from 'lucide-react';
import { LandingSection } from './ui';

type Kind = { id: string; label: string; image: string; overlay: ReactNode; film?: Film; weight?: number };
// A segment can show a real film instead of a still. It never plays on its own: scroll position scrubs it.
// The scrub copy is 720p30 with a keyframe every 6 frames, so seeking stays smooth.
type Film = { src: string; poster: string; duration: number };

// Each segment swaps the preview: its footage and its motion overlay.
const kinds: Kind[] = [
  {
    // Revline's own launch film, made in Revline from two screenshots; its titles are in the film, so no overlay.
    // Scrolling through this segment scrubs the film, so it gets more scroll room than the stills.
    id: 'launch', label: 'Launch videos', image: 'vlog', weight: 4,
    overlay: null,
    film: { src: '/landing/revline-launch-scrub.mp4', poster: '/landing/revline-launch-poster.webp', duration: 37.92 },
  },
  {
    id: 'explainers', label: 'Explainers', image: 'code-screen',
    overlay: <p className="landing-motion-title">Complex ideas,<br /><b>made simple.</b></p>,
  },
  {
    id: 'elements', label: 'Motion elements', image: 'talking-head',
    overlay: <div className="landing-motion-elements">
      <span className="landing-motion-sticker">New feature</span>
      <div className="landing-motion-lower"><b>Zura</b><span>Founder, Revline</span></div>
    </div>,
  },
  {
    id: 'demos', label: 'Product demos', image: 'product-window',
    overlay: <div className="landing-motion-demo">
      <span className="landing-motion-focus"><MousePointer2 size={22} /></span>
      <p className="landing-motion-title">Zoom follows<br /><b>the cursor.</b></p>
    </div>,
  },
];
// Scroll distance one unit of segment weight holds the pinned section for, in viewport heights.
const SCROLL_PER_UNIT = .7;
const units = kinds.map(kind => kind.weight ?? 1), totalUnits = units.reduce((sum, unit) => sum + unit, 0);

/** The film behind a segment, held on the frame that the scroll position picks. */
function FilmScene({ film, time }: { film: Film; time: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const wanted = useRef(time);
  // The hosted assets answer without byte ranges, so seek within an in-memory copy fetched once.
  useEffect(() => {
    let url = '';
    const controller = new AbortController();
    void fetch(film.src, { signal: controller.signal }).then(response => response.ok ? response.blob() : null)
      .then(blob => { url = blob ? URL.createObjectURL(blob) : film.src; setSrc(url); })
      .catch(() => { if (!controller.signal.aborted) setSrc(film.src); });
    return () => { controller.abort(); if (url.startsWith('blob:')) URL.revokeObjectURL(url); };
  }, [film.src]);
  // One seek at a time; the latest scroll position wins once the current seek lands.
  useEffect(() => {
    wanted.current = time;
    const element = video.current;
    if (element && !element.seeking && element.readyState >= 1) element.currentTime = time;
  }, [time, src]);
  return <video ref={video} className="landing-motion-film" src={src ?? undefined} poster={film.poster} muted playsInline preload="auto"
    onLoadedMetadata={event => { event.currentTarget.currentTime = wanted.current; }}
    onSeeked={event => { if (Math.abs(event.currentTarget.currentTime - wanted.current) > .02) event.currentTarget.currentTime = wanted.current; }} />;
}

export function LandingMotion() {
  const [active, setActive] = useState(0);
  const [filmTime, setFilmTime] = useState(0);
  const track = useRef<HTMLElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  // The white pill slides under the active segment.
  useLayoutEffect(() => {
    const measure = () => { const tab = tabs.current[active]; if (tab) setIndicator({ left: tab.offsetLeft, width: tab.offsetWidth }); };
    measure();
    addEventListener('resize', measure);
    return () => removeEventListener('resize', measure);
  }, [active]);

  // The section pins to the viewport while its tall track scrolls past; scroll position picks the segment and
  // scrubs the film. Nothing moves on its own: it only switches when the scroll-picked segment changes, so a
  // clicked tab stays put until the visitor scrolls into another segment.
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
      let at = progress * totalUnits, index = 0;
      while (index < kinds.length - 1 && at >= units[index]) { at -= units[index]; index++; }
      const film = kinds[index].film;
      if (film) setFilmTime(Math.min(1, at / units[index]) * (film.duration - .05));
      if (index !== picked) { picked = index; setActive(index); }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    return () => { removeEventListener('scroll', schedule); removeEventListener('resize', schedule); cancelAnimationFrame(frame); };
  }, []);

  const kind = kinds[active];
  return <LandingSection ref={track} id="motion" className="landing-motion" headingId="landing-motion-heading" data-nav-tone="dark" style={{ height: `calc(100svh + ${(totalUnits - 1) * SCROLL_PER_UNIT * 100}svh)` }}>
    <div className="landing-motion-pin">
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
          {item.film ? <FilmScene film={item.film} time={filmTime} /> : <div className="landing-motion-shade">{item.overlay}</div>}
        </div>)}
      </div>
    </div>
  </LandingSection>;
}
