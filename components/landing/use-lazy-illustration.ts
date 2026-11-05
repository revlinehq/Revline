'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';

type Animation = ComponentType<{ playing: boolean }>;

/** Load and play only inside the viewport. */
export function useLazyIllustration(loadAnimation: () => Promise<{ default: Animation }>) {
  const frame = useRef<HTMLDivElement>(null);
  const [nearby, setNearby] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [Animation, setAnimation] = useState<ComponentType<{
    playing: boolean;
  }> | null>(null);
  useEffect(() => {
    if (!nearby) return;
    let cancelled = false;
    void loadAnimation().then((module) => {
      if (!cancelled) setAnimation(() => module.default);
    });
    return () => {
      cancelled = true;
    };
  }, [nearby, loadAnimation]);
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
      { rootMargin: '0px' },
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
  return { frame, Animation, playing };
}
