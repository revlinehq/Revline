'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Link2 } from 'lucide-react';
import { LandingHeading, LandingSection } from './ui';

type Film = { src: string; poster?: string };
// The launch film that inspired ours, and Revline's recreation of it from a pasted link.
const ORIGINAL: Film & { source: string; href: string } = { src: '/landing/inspo-original.mp4', poster: '/landing/inspo-original-poster.webp', source: '@rightnowai_co on X', href: 'https://x.com/rightnowai_co/status/2116311411072835913' };
// Not exported yet: the card shows a placeholder until this file exists.
const REMAKE: Film | null = null;

/** Both films play together, muted and looping, while the section is on screen. */
function useOnScreen<T extends Element>() {
  const ref = useRef<T>(null);
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: .3 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, onScreen] as const;
}

function FilmCard({ film, label, note, playing }: { film: Film | null; label: string; note?: ReactNode; playing: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    // Server-rendered HTML can't carry `muted`, so set it before asking to play.
    element.muted = true;
    if (playing) void element.play().catch(() => {}); else element.pause();
  }, [playing]);
  return <figure className="landing-inspo-card">
    <div className="landing-inspo-frame">
      {film ? <video ref={video} src={film.src} poster={film.poster} muted loop playsInline preload="metadata" /> : <div className="landing-inspo-pending">Recreation renders here after export</div>}
    </div>
    <figcaption><b>{label}</b>{note && <span>{note}</span>}</figcaption>
  </figure>;
}

export function LandingInspo() {
  const [ref, onScreen] = useOnScreen<HTMLDivElement>();
  return <LandingSection id="inspo" className="landing-inspo" headingId="landing-inspo-heading" data-nav-tone="dark">
    <LandingHeading id="landing-inspo-heading" align="center" tone="inverse" size="lg" title={<>Introducing <b>Inspo Motion</b></>} description="Seen a launch video you love? Drop its link in the chat and Revline recreates it, shot for shot, for your launch." />
    <div className="landing-inspo-prompt" aria-label="Example prompt">
      <span className="landing-inspo-link"><Link2 size={15} aria-hidden="true" />x.com/rightnowai_co/status/2116…</span>
      <span className="landing-inspo-ask">Recreate this for our launch</span>
      <span className="landing-inspo-send" aria-hidden="true"><ArrowUp size={16} /></span>
    </div>
    <div ref={ref} className="landing-inspo-films">
      <FilmCard film={ORIGINAL} label="The inspiration" note={<a href={ORIGINAL.href} target="_blank" rel="noreferrer">{ORIGINAL.source}</a>} playing={onScreen} />
      <FilmCard film={REMAKE} label="Recreated in Revline" note="From one pasted link" playing={onScreen} />
    </div>
  </LandingSection>;
}
