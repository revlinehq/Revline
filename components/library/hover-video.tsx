'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { useConvex } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

/** How long the pointer rests on a tile before its video loads, so sweeping across the grid loads nothing. */
const HOVER_DELAY = 150;
/** How long a fetched link is reused. Signed links last days; an hour also picks up a preview made since. */
const LINK_AGE = 60 * 60_000;
/** Stops the one tile playing now; a tile that starts playing stops it first. */
let stopPlaying: (() => void) | null = null;
/** Each file's playable link, asked for once and reused for a while. */
const links = new Map<string, { link: Promise<string | null>; at: number }>();

function hoverLink(fileId: Id<'storageObjects'>, ask: () => Promise<string | null>) {
  const cached = links.get(fileId);
  if (cached && Date.now() - cached.at < LINK_AGE) return cached.link;
  const link = ask().catch(() => null);
  links.set(fileId, { link, at: Date.now() });
  return link;
}

/** Plays a video tile while a mouse or pen rests on it: muted, inline and looping, over the tile's picture. The video
 *  element exists only while hovered, so a grid downloads nothing until then, and it stays hidden until its first frame
 *  plays, so the picture shows meanwhile. Touch keeps the tile still. `knownUrl` is a link the listing already holds
 *  (a video no project uses, so it has no lighter preview); other files ask for their lightest playable link. */
export function useHoverVideo(fileId: Id<'storageObjects'>, playable: boolean, knownUrl: string | null) {
  const convex = useConvex();
  const [src, setSrc] = useState<string | null>(null), [playing, setPlaying] = useState(false);
  const timer = useRef<number | undefined>(undefined), hovering = useRef(false);
  const stop = useCallback(() => {
    hovering.current = false; window.clearTimeout(timer.current);
    setSrc(null); setPlaying(false);
    if (stopPlaying === stop) stopPlaying = null;
  }, []);
  useEffect(() => stop, [stop]);
  // React sets `muted` as a property after the element exists; setting it first keeps autoplay allowed.
  const begin = useCallback((node: HTMLVideoElement | null) => { if (node) { node.muted = true; void node.play().catch(() => {}); } }, []);
  function start(event: PointerEvent) {
    if (!playable || event.pointerType === 'touch') return;
    hovering.current = true; window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const url = knownUrl ?? await hoverLink(fileId, () => convex.query(api.library.hoverVideoUrl, { fileId }));
      if (!url) links.delete(fileId);
      if (!url || !hovering.current) return;
      if (stopPlaying !== stop) stopPlaying?.();
      stopPlaying = stop;
      setSrc(url);
    }, HOVER_DELAY);
  }
  // A failed load (a dropped connection, an expired link, a codec the browser lacks) shows the picture again and
  // asks for a fresh link on the next hover.
  const video = src ? <video className="library-hover-video" src={src} muted playsInline loop autoPlay preload="auto" tabIndex={-1} aria-hidden="true"
    data-playing={playing || undefined} ref={begin}
    onPlaying={() => setPlaying(true)} onError={() => { links.delete(fileId); stop(); }} /> : null;
  return { video, stop, handlers: { onPointerEnter: start, onPointerLeave: stop } };
}
