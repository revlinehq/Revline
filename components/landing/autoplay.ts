'use client';
import { useEffect, useRef } from 'react';

/**
 * Plays a muted landing film while it is on screen and pauses it off screen.
 * React does not always write `muted` to the DOM, and iOS Safari only autoplays
 * a muted inline video, so both are set on the element before every play().
 * A refused play (Low Power Mode, data saver) leaves the poster and the native play control.
 */
export function useLandingAutoplay() {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = video.defaultMuted = true;
    video.playsInline = true;
    // A pause the visitor made with the controls holds until they press play again.
    let visible = false, held = false, ours = false;
    const pause = () => { if (video.paused) return; ours = true; video.pause(); };
    const paused = () => { if (ours) ours = false; else held = true; };
    const playing = () => { held = false; };
    const play = () => {
      if (held || !visible || document.hidden || !video.paused) return;
      video.muted = true;
      void video.play().catch(() => {});
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) play(); else pause();
    }, { threshold: 0.25 });
    const visibility = () => { if (document.hidden) pause(); else play(); };
    observer.observe(video);
    // A play() refused before the data arrived is asked again once it can play.
    video.addEventListener('canplay', play);
    video.addEventListener('pause', paused);
    video.addEventListener('play', playing);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      observer.disconnect();
      video.removeEventListener('canplay', play);
      video.removeEventListener('pause', paused);
      video.removeEventListener('play', playing);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  return ref;
}
