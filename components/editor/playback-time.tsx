'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { formatTime } from '@/lib/editor/types';
import { usePausedPlaybackTime } from './editor-state';

/** Paused values come from the editor store, so callers pass no `time`. */
export function EditorPlaybackTime(props: Omit<React.ComponentProps<typeof PlaybackTime>, 'time'>) {
  const time = usePausedPlaybackTime();
  return <PlaybackTime {...props} time={time}/>;
}

export function PlaybackTime({ time, duration, playing, readTime, className }: {
  time: number; duration: number; fps: number; playing: boolean;
  readTime?: () => number; className: string;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const latestTime = useRef(time);
  latestTime.current = time;

  const position = (value: number) => Math.min(duration, Math.max(0, Number.isFinite(value) ? value : 0));
  const description = () => 'Playback time · minutes:seconds';

  function paint(value: number) {
    const node = element.current?.firstChild;
    const text = formatTime(position(value));
    if (node?.nodeType === Node.TEXT_NODE && node.nodeValue !== text) node.nodeValue = text;
    const title = description();
    if (element.current && element.current.title !== title) element.current.title = title;
  }

  // React still owns paused/seeking values. During playback, read the real
  // composition clock, rather than HyperFrames' throttled timeupdate events.
  useLayoutEffect(() => { paint(playing && readTime ? readTime() : time); }, [time, playing, readTime, duration]);
  useEffect(() => {
    if (!playing || !readTime) return;
    let frame = 0;
    const tick = () => {
      paint(readTime?.() ?? latestTime.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, readTime, duration]);

  return <span ref={element} className={className} title={description()}>{formatTime(position(time))}<span> / {formatTime(duration)}</span></span>;
}
