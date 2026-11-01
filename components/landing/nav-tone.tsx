'use client';

import { useEffect } from 'react';

/** Darkens the sticky nav while it sits over a section marked data-nav-tone="dark". */
export function LandingNavTone() {
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>('.landing-nav');
    if (!nav) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = nav.getBoundingClientRect().bottom - 1;
      const dark = [...document.querySelectorAll<HTMLElement>('[data-nav-tone=dark]')].some(section => {
        const box = section.getBoundingClientRect();
        return box.top <= line && box.bottom > line;
      });
      if (dark) nav.dataset.tone = 'dark'; else delete nav.dataset.tone;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    return () => { removeEventListener('scroll', schedule); removeEventListener('resize', schedule); cancelAnimationFrame(frame); };
  }, []);
  return null;
}
