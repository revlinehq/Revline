'use client';

import { type ReactNode } from 'react';
import { ArrowUp, Link2 } from 'lucide-react';
import { LandingHeading, LandingSection } from './ui';
import { useLandingVideoPlayback } from './use-video-playback';

type Film = { src: string; poster?: string };
// The launch film that inspired ours, and Revline's recreation of it from a pasted link.
const ORIGINAL: Film & { source: string; href: string } = { src: '/landing/inspo-original.mp4', poster: '/landing/inspo-original-poster.webp', source: '@rightnowai_co on X', href: 'https://x.com/rightnowai_co/status/2116311411072835913' };
const REMAKE: Film | null = { src: '/landing/inspo-remake.mp4', poster: '/landing/inspo-remake-poster.jpg' };

/** Each film follows its own visibility, including when the cards stack on phones. */
function FilmCard({ film, label, note }: { film: Film | null; label: string; note?: ReactNode }) {
  const video = useLandingVideoPlayback(film?.src);
  return <figure className="landing-inspo-card">
    <div className="landing-inspo-frame">
      {film ? <video ref={video} src={film.src} poster={film.poster} muted loop playsInline preload="none" /> : <div className="landing-inspo-pending">Recreation renders here after export</div>}
    </div>
    <figcaption><b>{label}</b>{note && <span>{note}</span>}</figcaption>
  </figure>;
}

export function LandingInspo() {
  return <LandingSection id="inspo" className="landing-inspo" headingId="landing-inspo-heading" data-nav-tone="dark">
    <LandingHeading id="landing-inspo-heading" align="center" tone="inverse" size="lg" title={<>Introducing <b className="landing-glitch" data-text="Inspo Motion">Inspo Motion</b></>} description="Seen a launch video you love? Drop its link in the chat and Revline recreates it, shot for shot, for your launch." />
    <div className="landing-inspo-prompt" aria-label="Example prompt">
      <span className="landing-inspo-link"><Link2 size={15} aria-hidden="true" />x.com/rightnowai_co/status/2116…</span>
      <span className="landing-inspo-ask">Recreate this for our launch</span>
      <span className="landing-inspo-send" aria-hidden="true"><ArrowUp size={16} /></span>
    </div>
    <div className="landing-inspo-films">
      <FilmCard film={ORIGINAL} label="The inspiration" note={<a href={ORIGINAL.href} target="_blank" rel="noreferrer">{ORIGINAL.source}</a>} />
      <FilmCard film={REMAKE} label="Recreated in Revline" note="From one pasted link" />
    </div>
  </LandingSection>;
}
