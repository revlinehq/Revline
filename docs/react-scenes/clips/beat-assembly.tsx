// Beat clip "T3 Code: assembly" (0 to 3.75 s). The previous title blows away, the headline rises, the
// dashboard builds piece by piece, then the headline and everything but the composer clear. The camera
// move into the composer is not here: the "Zoom into composer" transition clip draws it over this beat.
import type { ReactNode } from 'react';
import { Beat, Layer, progress, useBeat, useScene } from 'revline';
import { Window, captionStyle, type AppState } from 'blueprint:T3 Code';

const Gradient = ({ children }: { children: ReactNode }) =>
  <span style={{ background: 'linear-gradient(90deg,#ffffff,#c9b6ff)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{children}</span>;

/** The previous beat's title, "Meet T3 Code.", catches a shimmer and blows away. */
function Intro() {
  const { width } = useScene(), { time } = useBeat();
  const w = 760, h = 427.5, gone = progress(time, .2, .35, 'power2.in');
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, zoom: width / w, opacity: 1 - progress(time, .2, .4, 'power2.in'), background: 'radial-gradient(80% 90% at 50% 0%,#3b2a73,transparent 70%),radial-gradient(60% 70% at 100% 100%,#1d1640,transparent 70%),#08070d' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: h * .445, textAlign: 'center', font: `600 ${h * .11}px/1 Outfit`, color: '#fff', letterSpacing: -2, opacity: 1 - gone, transform: `scale(${1 + .04 * gone})`, filter: `blur(${10 * gone}px)` }}>
        Meet <Gradient>T3 Code.</Gradient>
        <div style={{ position: 'absolute', inset: 0, textAlign: 'center' }}>
          <span style={{ background: 'linear-gradient(100deg,transparent 35%,rgba(255,255,255,.95) 48%,rgba(214,194,255,.9) 52%,transparent 65%)', backgroundSize: '260% 100%', backgroundPosition: `${100 - 100 * progress(time, 0, .4, 'sine.inOut')}% 0`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Meet T3 Code.</span>
        </div>
      </div>
    </div>
  );
}

/** The headline rises and the dashboard builds piece by piece; then everything but the composer clears. */
function Assembly() {
  const { height } = useScene(), { time } = useBeat();
  const at = (start: number, duration = .5, curve = 'power3.out') => progress(time, start, duration, curve);
  const clear = 1 - at(2.45, .45, 'power2.in');
  const fade = (p: number, move: string) => ({ opacity: p * clear, transform: move });
  const items = (['worked', 'answer', 'files'] as const).map((name, index) => [name, at(1.45 + index * .1)] as const);
  const diff = (['diff-head', 'hunk-a', 'hunk-b', 'hunk-c'] as const).map((name, index) => [name, at(2.05 + index * .07)] as const);
  const sidebar = at(1, .55), header = at(1.25, .45), composer = at(1.8);
  const parts: AppState['parts'] = {
    window: { opacity: at(.85, .5, 'power2.out') * clear },
    sidebar: fade(sidebar, `translateX(${-30 * (1 - sidebar)}px)`),
    header: fade(header, `translateY(${-10 * (1 - header)}px)`),
    ...Object.fromEntries(items.map(([name, p]) => [name, fade(p, `translateY(${10 * (1 - p)}px)`)])),
    composer: { opacity: composer, transform: `translateY(${16 * (1 - composer)}px)` },
    footer: { opacity: composer, transform: `translateY(${16 * (1 - composer)}px)` },
    ...Object.fromEntries(diff.map(([name, p]) => [name, fade(p, `translateX(${30 * (1 - p)}px)`)])),
  };
  const shown = at(0, .5, 'power2.out'), rise = at(.45, .6, 'power3.inOut'), gone = at(2.35, .4, 'power2.in');
  return <>
    <Window id="a" camera={{ zoom: 1, x: 0, y: 0 }} state={{ parts }} />
    <div style={{ ...captionStyle(height), opacity: shown * (1 - gone), filter: `blur(${8 * (1 - shown) + 8 * gone}px)`, transform: `translateY(${(height / 2 - height * .1275) * (1 - rise)}px)` }}>First ADE made for developers.</div>
  </>;
}

export default function AssemblyBeat() {
  return (
    <Layer style={{ background: 'radial-gradient(70% 60% at 50% 45%,#141019,#050507)', overflow: 'hidden' }}>
      <Beat id="intro" duration={.65}><Intro /></Beat>
      <Beat start={.5}><Assembly /></Beat>
    </Layer>
  );
}
