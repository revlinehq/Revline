'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Card } from '@/components/ui/card';
import { LandingStartButton } from './start-button';
import { LandingHeading, LandingSection } from './ui';

/** The film's editor and montage, rendered as a passive, viewport-driven illustration. */
export function LandingClippers() {
  const frame = useRef<HTMLDivElement>(null);
  const [nearby, setNearby] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [Animation, setAnimation] = useState<ComponentType<{
    playing: boolean;
  }> | null>(null);
  useEffect(() => {
    if (!nearby) return;
    let cancelled = false;
    void import('./clippers-animation').then((module) => {
      if (!cancelled) setAnimation(() => module.default);
    });
    return () => {
      cancelled = true;
    };
  }, [nearby]);
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const load = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNearby(true);
          load.disconnect();
        }
      },
      { rootMargin: '320px' },
    );
    const playback = new IntersectionObserver(([entry]) =>
      setPlaying(entry.isIntersecting),
    );
    load.observe(node);
    playback.observe(node);
    return () => {
      load.disconnect();
      playback.disconnect();
    };
  }, []);
  return (
    <LandingSection
      id="clippers"
      className="landing-clippers"
      headingId="landing-clippers-heading"
    >
      <div className="landing-showcase-copy">
        <LandingHeading
          id="landing-clippers-heading"
          title="Revline for clippers"
          description="Turn interviews, podcasts and tech streams into captioned Shorts and Reels, ready to post."
        />
        <LandingStartButton label="Start clipping" size="sm" />
      </div>
      <Card
        ref={frame}
        className="landing-clippers-frame"
        role="img"
        aria-label="Revline turns tech interviews, podcasts and streams into vertical clips, then reveals six videos with illustrative view counts."
      >
        <img
          className="landing-clippers-still"
          src="/landing/clippers-still.webp"
          alt=""
          loading="lazy"
        />
        {Animation && <Animation playing={playing} />}
      </Card>
    </LandingSection>
  );
}
