'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Card } from '@/components/ui/card';
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
      <Card className="landing-showcase-card">
        <LandingHeading
          id="landing-clippers-heading"
          title="Revline for clippers"
          description="Drop in a stream and get vertical clips with the creator on top and the gameplay below, ready to post."
        />
        <Card
          ref={frame}
          className="landing-clippers-frame"
          role="img"
          aria-label="Revline splits a stream into ten vertical clips, then reveals six creator videos with illustrative view counts."
        >
          <img
            className="landing-clippers-still"
            src="/landing/clippers-still.webp"
            alt=""
            loading="lazy"
          />
          {Animation && <Animation playing={playing} />}
        </Card>
      </Card>
    </LandingSection>
  );
}
