import type { SVGProps } from 'react';

// Original vector drawings from Pen: Revline / custom effect icons (mzzBL).
const glyphs = {
  crossfade: [{ d: 'M3 5h11v14H3z M10 5h11v14H10z', stroke: true, opacity: 1 }, { d: 'M10 5h4v14h-4z', stroke: false, opacity: .28 }],
  wipe: [{ d: 'M3 5h18v14H3z M13 5v14 M6 12h4 M8 10l2 2-2 2', stroke: true, opacity: 1 }, { d: 'M3 5h10v14H3z', stroke: false, opacity: .18 }],
  slide: [{ d: 'M3 5h6v14H3z M15 5h6v14h-6z M6 12h12 M15 9l3 3-3 3', stroke: true, opacity: 1 }],
  'solid-color': [{ d: 'M4 5h16v14H4z', stroke: true, opacity: 1 }, { d: 'M7 8h10v8H7z', stroke: false, opacity: .28 }],
  'glitch': [{"d":"M4 5h14v4h3v3h-15v3h-3v3h16m-16-9h9m0 6h10","stroke":true,"opacity":1}],
  'zoomBlur': [{"d":"M7 7h10v10h-10z m-4-4l3 3m12 0l3-3m-18 18l3-3m12 0l3 3","stroke":true,"opacity":1},{"d":"M9 9h6v6h-6z","stroke":false,"opacity":0.28}],
  'colorGrade': [{"d":"M5 3v6m0 4v8m7-18v11m0 4v3m7-18v3m0 4v11m-16-10h4m3 5h4m3-8h4","stroke":true,"opacity":1}],
  'invert': [{"d":"M12 3a9 9 0 0 1 0 18 9 9 0 0 1 0-18z m0 0v18","stroke":true,"opacity":1},{"d":"M12 3a9 9 0 0 1 0 18z","stroke":false,"opacity":0.28}],
  'cinematic-bars': [{"d":"M3 7h18m-18 10h18m-12-14l3 2 3-2m-6 18l3-2 3 2","stroke":true,"opacity":1},{"d":"M3 5h18v2h-18z m0 12h18v2h-18z","stroke":false,"opacity":0.28}],
  'quick-zoom-in': [{"d":"M3 8v-5h5m8 0h5v5m0 8v5h-5m-8 0h-5v-5m5-8l3 3m-3 0h3v-3m5 8l-3-3m0 3v-3h3","stroke":true,"opacity":1}],
  'quick-zoom-out': [{"d":"M8 8h8v8h-8z m-2-2l-3-3m0 3v-3h3m12 15l3 3m-3 0h3v-3","stroke":true,"opacity":1}],
  'punch': [{"d":"M8 8h8v8h-8z m-5 4h2m14 0h2m-9-9v2m0 14v2m-7-16l2 2m10 10l2 2","stroke":true,"opacity":1}],
  'fade': [{"d":"M3 5h4v14h-4z m7 0h4v14h-4z m7 0h4v14h-4z","stroke":true,"opacity":1},{"d":"M17 5h4v14h-4z","stroke":false,"opacity":0.28}],
  'pop': [{"d":"M7 17l5-10 5 10m-8-4h6m-12-6v-4h4m10 0h4v4m-18 10v4h4m10 0h4v-4","stroke":true,"opacity":1}],
  'shake': [{"d":"M8 6h8v12h-8z m-5-1l2 4-2 4 2 4m16-10l-2 4 2 4-2 4","stroke":true,"opacity":1}],
  'flash': [{"d":"M4 4h5m-5 0v5m16 6v5h-5m-1-17l-7 10h4l-1 8 7-11h-4z","stroke":true,"opacity":1}],
  'fade-through-black': [{"d":"M3 6h6v12h-6z m12 0h6v12h-6z m-5 6h4","stroke":true,"opacity":1},{"d":"M15 6h6v12h-6z","stroke":false,"opacity":0.28}],
  'speed-up': [{"d":"M4 6l6 6-6 6m8-12l6 6-6 6m9-12v12","stroke":true,"opacity":1}],
  'slow-down': [{"d":"M4 7v10m4-10v10m5-10l6 5-6 5m8-9v8","stroke":true,"opacity":1}],
  'word-reveal': [{"d":"M3 8h4v8h-4z m7 0h4v8h-4z m7 0h4v8h-4z","stroke":true,"opacity":1},{"d":"M3 8h4v8h-4z","stroke":false,"opacity":0.28}],
  'word-pop': [{"d":"M3 18h18m-16-4l3-8 3 8m-5-3h4m6-5h4v8h-4z m-8-3v-2","stroke":true,"opacity":1}],
  'slide-title': [{"d":"M3 5h15m-15 0l3-3m-3 3l3 3m1 12l5-10 5 10m-8-4h6","stroke":true,"opacity":1}],
  'karaoke': [{"d":"M3 7h5m3 0h5m3 0h2m-18 5h9m3 0h6m-18 5h5m3 0h6","stroke":true,"opacity":1},{"d":"M3 10h9v4h-9z","stroke":false,"opacity":0.28}],
  'neon-echo': [{"d":"M3 18l5-12 5 12m-8-4h6m-1-8h3l5 12m-2-12h2l4 12","stroke":true,"opacity":1}],
  'lyric-slam': [{"d":"M4 5h16m-16 0v3m16-3v3m-8-3v11m-8 4h16m-13-2l5 2 5-2","stroke":true,"opacity":1}],
  'kinetic-stack': [{"d":"M5 4h14m-16 5h14m-10 5h14m-16 5h10","stroke":true,"opacity":1},{"d":"M5 17h10v4h-10z","stroke":false,"opacity":0.28}],
  dither: [{ d: 'M4 4h16v16H4z', stroke: true, opacity: 1 }, { d: 'M5 5h3v3H5z M13 5h3v3h-3z M9 9h3v3H9z M17 9h2v3h-2z M5 13h3v3H5z M13 13h3v3h-3z M9 17h3v2H9z M17 17h2v2h-2z', stroke: false, opacity: 1 }],
} as const;
export type EffectIconName = keyof typeof glyphs;
export function EffectIcon({ name, size = 16, ...props }: SVGProps<SVGSVGElement> & { name: EffectIconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>{glyphs[name].map((path,index) => <path key={index} d={path.d} fill={path.stroke ? 'none' : 'currentColor'} stroke={path.stroke ? 'currentColor' : 'none'} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={path.opacity}/>)}</svg>;
}
