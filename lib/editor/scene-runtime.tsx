// Runs inside each scene's sandboxed frame (opaque origin, no network). The
// composition sends the clip-local time; the scene renders that exact frame
// synchronously and acknowledges once fonts and images are ready.
import * as React from 'react';
import * as JsxRuntime from 'react/jsx-runtime';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { transform } from 'sucrase';

type SceneState = { t: number; fps: number; duration: number; width: number; height: number };
type Init = { type: 'init'; code: string; width: number; height: number; fps: number; duration: number; fonts: { family: string; weight: string; data: ArrayBuffer }[] };
type Seek = { type: 'seek'; time: number; seq: number };

const SceneContext = React.createContext<SceneState>({ t: 0, fps: 30, duration: 1, width: 1080, height: 1920 });

/** The clip-local clock. Every visible value must be computed from t. */
export function useScene() {
  const scene = React.useContext(SceneContext);
  return { ...scene, frame: Math.round(scene.t * scene.fps), progress: Math.min(1, Math.max(0, scene.t / scene.duration)) };
}

const back = 1.70158;
export const Easing = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => t * (2 - t),
  inOutQuad: (t: number) => t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2,
  outExpo: (t: number) => t >= 1 ? 1 : 1 - 2 ** (-10 * t),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t: number) => 1 + (back + 1) * (t - 1) ** 3 + back * (t - 1) ** 2,
  /** The shared vocabulary: enter settles fast, draw moves evenly, pop overshoots. */
  enter: (t: number) => t >= 1 ? 1 : 1 - 2 ** (-10 * t),
  draw: (t: number) => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2,
  pop: (t: number) => 1 + (back + 1) * (t - 1) ** 3 + back * (t - 1) ** 2,
};

/** Map input through ranges, clamped at both ends by default. */
export function interpolate(input: number, inputRange: number[], outputRange: number[], options: { easing?: (t: number) => number; clamp?: boolean } = {}) {
  if (inputRange.length < 2 || inputRange.length !== outputRange.length) throw new Error('interpolate needs matching input and output ranges with at least two points.');
  const clamp = options.clamp ?? true, ease = options.easing ?? Easing.linear;
  let segment = 0;
  while (segment < inputRange.length - 2 && input > inputRange[segment + 1]) segment++;
  const [a, b] = [inputRange[segment], inputRange[segment + 1]], [from, to] = [outputRange[segment], outputRange[segment + 1]];
  let progress = b === a ? 1 : (input - a) / (b - a);
  if (clamp) progress = Math.min(1, Math.max(0, progress));
  return from + (to - from) * ease(progress);
}

/** The three motion helpers: each returns 0→1 eased progress at the current time. */
export function useMotion() {
  const { t } = useScene();
  const at = (ease: (t: number) => number) => (start: number, duration: number) => ease(Math.min(1, Math.max(0, (t - start) / duration)));
  return { enter: (start: number, duration = .6) => at(Easing.enter)(start, duration), draw: (start: number, duration = .8) => at(Easing.draw)(start, duration), pop: (start: number, duration = .45) => at(Easing.pop)(start, duration) };
}

/** A hard cut: children stay mounted and are visible over [from, to). */
export function Show({ from, to = Infinity, children }: { from: number; to?: number; children?: React.ReactNode }) {
  const { t } = useScene();
  return <div style={{ position: 'absolute', inset: 0, visibility: t >= from && t < to ? 'visible' : 'hidden' }}>{children}</div>;
}

/** One caption line at a time; each item lasts until the next one starts. */
export function Captions({ items, style }: { items: { at: number; until?: number; text: string }[]; style?: React.CSSProperties }) {
  const { t } = useScene();
  const sorted = [...items].sort((a, b) => a.at - b.at);
  const active = sorted.find((item, index) => t >= item.at && t < (item.until ?? sorted[index + 1]?.at ?? Infinity));
  return active ? <div style={{ position: 'absolute', left: '10%', right: '10%', bottom: '12%', textAlign: 'center', fontSize: 54, fontWeight: 700, ...style }}>{active.text}</div> : null;
}

/** Deterministic pseudo-random numbers keyed by a seed. */
export function random(seed: number | string) {
  let h = 2166136261;
  for (const character of String(seed)) h = Math.imul(h ^ character.charCodeAt(0), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const api = { useScene, useMotion, Easing, interpolate, Show, Captions, random };

class Boundary extends React.Component<{ children?: React.ReactNode; onError(message: string): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { this.props.onError(error instanceof Error ? error.message : String(error)); }
  render() { return this.state.failed ? null : this.props.children; }
}

function post(message: Record<string, unknown>) { window.parent.postMessage({ source: 'revline-scene', ...message }, '*'); }

/** Compile a scene module. It may import only react and revline. */
export function compileScene(code: string): React.ComponentType {
  const compiled = transform(code, { transforms: ['jsx', 'typescript', 'imports'], jsxRuntime: 'automatic', production: true }).code;
  const modules: Record<string, unknown> = { react: React, 'react/jsx-runtime': JsxRuntime, revline: api };
  const module = { exports: {} as Record<string, unknown> };
  const require = (name: string) => { if (!(name in modules)) throw new Error(`Scenes can import only "react" and "revline", not "${name}".`); return modules[name]; };
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
  const scene = module.exports.default ?? module.exports.Scene;
  if (typeof scene !== 'function') throw new Error('A scene must export default a React component.');
  return scene as React.ComponentType;
}

if (typeof window !== 'undefined' && window.parent !== window) {
  const element = document.getElementById('scene-root')!;
  const root = createRoot(element);
  let Scene: React.ComponentType | null = null, settings: Omit<Init, 'type' | 'code' | 'fonts'> | null = null, failed = false;
  const fail = (message: string) => { if (failed) return; failed = true; post({ type: 'error', message }); };
  // Math.random would differ between preview and export; reseed it per frame.
  let state = 1;
  Math.random = () => { state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6D2B79F5) >>> 0; return state / 4294967296; };
  const render = (time: number) => {
    const Component = Scene;
    if (!Component || !settings) return;
    state = 1;
    const value = { ...settings, t: time };
    flushSync(() => root.render(<SceneContext.Provider value={value}><Boundary onError={fail}><Component/></Boundary></SceneContext.Provider>));
  };
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.source !== 'revline-scene-host') return;
    const data = event.data as Init | Seek;
    if (data.type === 'init') {
      void (async () => {
        try {
          for (const font of data.fonts) { const face = new FontFace(font.family, font.data, { weight: font.weight }); await face.load(); document.fonts.add(face); }
          settings = { width: data.width, height: data.height, fps: data.fps, duration: data.duration };
          Scene = compileScene(data.code);
          render(0);
          post({ type: 'compiled' });
        } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
      })();
    } else if (data.type === 'seek') {
      try { render(data.time); } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
      const images = Array.from(document.images).filter(image => !image.complete).map(image => image.decode().catch(() => undefined));
      void Promise.all([document.fonts.ready, ...images]).then(() => post({ type: 'painted', seq: data.seq }));
    }
  });
  post({ type: 'ready' });
}
