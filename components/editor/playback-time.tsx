'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { formatTime } from '@/lib/editor/types';
import { usePausedPlaybackTime } from './editor-state';

export function EditorPlaybackTime(props: React.ComponentProps<typeof PlaybackTime>) {
  const time = usePausedPlaybackTime();
  return <PlaybackTime {...props} time={time}/>;
}

export function PlaybackTime({ time, duration, fps, playing, readTime, className }: {
  time: number; duration: number; fps: number; playing: boolean;
  readTime?: () => number; className: string;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const latestTime = useRef(time);
  latestTime.current = time;

  const position = (value: number) => Math.min(duration, Math.max(0, Number.isFinite(value) ? value : 0));
  const description = () => `Frame timecode · minutes:seconds:frames · ${fps} fps`;

  function paint(value: number) {
    const node = element.current?.firstChild;
    const text = formatTime(position(value), true, fps);
    if (node?.nodeType === Node.TEXT_NODE && node.nodeValue !== text) node.nodeValue = text;
    const title = description();
    if (element.current && element.current.title !== title) element.current.title = title;
  }

  // React still owns paused/seeking values. During playback, read the real
  // composition clock, rather than HyperFrames' throttled timeupdate events.
  useLayoutEffect(() => { paint(playing && readTime ? readTime() : time); }, [time, playing, readTime, duration, fps]);
  useEffect(() => {
    if (!playing || !readTime) return;
    let frame = 0;
    const tick = () => {
      paint(readTime?.() ?? latestTime.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, readTime, duration, fps]);

  return <span ref={element} className={className} title={description()}>{formatTime(position(time), true, fps)}<span> / {formatTime(duration, true, fps)}</span></span>;
}
