// The opt-in React scene format. A scene is a component tree; time is an input, never state.
// The frame loads this file beside scene-runtime.js only for scenes that import 'revline'.
// Every seek sets the clock to a frame and commits synchronously, so preview, scrubbing and
// export draw the same DOM for the same frame. Only components that read time re-render.
import * as React from 'react';
import * as ReactJSXRuntime from 'react/jsx-runtime';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { FrameAdapter } from '@hyperframes/core';
import type { gsap as Gsap } from 'gsap';
import { parseStartExpression } from '@hyperframes/core/runtime/start-expression';
import type { SceneBrandContext } from './brand-kit';
import type { SceneRuntimeModules } from './scene-modules';

const { Activity, createContext, memo, useContext, useLayoutEffect, useMemo, useRef, useSyncExternalStore } = React;

export type Ease = string | ((progress: number) => number);
/** What a scene component receives, and what useScene() returns anywhere below it. */
export type SceneProps = { width: number; height: number; duration: number; fps: number; brand: SceneBrandContext | null; media: Record<string, string> };
/** Time inside the nearest beat (or the scene): seconds, frames and 0..1 progress. */
export type BeatTime = { time: number; frame: number; fps: number; start: number; duration: number; progress: number };
/** A beat clip next to a transition clip, compiled in the transition's frame. `start` is in the transition's seconds. */
export type SceneNeighbour = { role: 'from' | 'to'; Scene: React.ComponentType<SceneProps>; start: number; duration: number };
export type ReactSceneOptions = SceneProps & {
  root: HTMLElement;
  Scene: React.ComponentType<SceneProps>;
  /** Set for a transition clip: the beat clips it joins. */
  neighbours?: SceneNeighbour[];
  icons: Record<string, string>;
  blueprint: (name: string, container: HTMLElement, size?: { width: number; height: number }) => HTMLElement;
  parseEase: (name: string) => (progress: number) => number;
  /** The frame's GSAP, with its plugins registered, for useTimeline. */
  gsap: typeof Gsap;
};

/** The frame clock. Components subscribe to it instead of receiving time through props, so a seek
 * re-renders only the components that read time, and static subtrees stay as they were mounted. */
class Clock {
  frame = 0;
  private listeners = new Set<() => void>();
  private seekers = new Set<() => void>();
  renderers = new Set<() => Promise<void>>();
  updates = new Set<() => Promise<void>>();
  commits = new Set<() => Promise<void>>();
  work = new Set<Promise<void>>();
  failure: unknown = null;
  hold(promise: Promise<unknown>) {
    const work = promise.then(() => undefined, error => { this.failure = error; });
    this.work.add(work);
    void work.then(() => this.work.delete(work));
  }
  async settle() {
    do {
      while (this.work.size) await Promise.all(this.work);
      for (const commit of this.commits) await commit();
    } while (this.work.size);
    if (this.failure) throw this.failure;
    this.seek();
    for (const update of this.updates) await update();
    if (this.failure) throw this.failure;
    for (const render of this.renderers) await render();
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  /** GSAP timelines seek after React has drawn the frame, so they read beat starts that moved in it. */
  follow = (seeker: () => void) => { this.seekers.add(seeker); return () => { this.seekers.delete(seeker); }; };
  set(frame: number) { this.frame = frame; this.notify(); }
  notify() { this.listeners.forEach(listener => listener()); }
  seek() { this.seekers.forEach(seeker => seeker()); }
}

type SceneState = SceneProps & { clock: Clock; icons: Record<string, string>; blueprint: ReactSceneOptions['blueprint']; neighbours: SceneNeighbour[] };
/** A beat's window on the scene clock, plus where its child beats record theirs for relative starts.
 * `frame` maps the scene clock to this subtree's clock: identity, except inside a neighbour clip. */
type BeatWindow = { readonly start: number; duration: number; frame: (clock: number) => number; beats: Map<string, { start: number; duration: number }> };
/** A Beat's window. One per mounted beat: a start that moves every frame (a remapped source clock)
 * changes its numbers, never its identity, so the timelines below it stay built. Its start reads
 * through its parents, so nested beats follow a moving ancestor without re-rendering. */
class BeatSpan implements BeatWindow {
  local = 0;
  duration = 0;
  beats = new Map<string, { start: number; duration: number }>();
  frame: (clock: number) => number;
  constructor(private parent: BeatWindow) { this.frame = parent.frame; }
  get start() { return this.parent.start + this.local; }
}
const same = (frame: number) => frame;
const SceneContext = createContext<SceneState | null>(null);
const BeatContext = createContext<BeatWindow | null>(null);

let parseEase: ReactSceneOptions['parseEase'] = () => progress => progress;
let pending: Promise<unknown>[] = [];
let gsap: typeof Gsap | null = null;

function useSceneState() {
  const scene = useContext(SceneContext);
  if (!scene) throw new Error('Revline hooks work only inside a scene.');
  return scene;
}

/** Context bridge for renderers with a separate React root, such as R3F. */
export function useSceneBridge() {
  const state = useSceneState(), beat = useContext(BeatContext)!;
  return useMemo(() => ({
    wrap: (children: React.ReactNode) => <SceneContext.Provider value={state}><BeatContext.Provider value={beat}>{children}</BeatContext.Provider></SceneContext.Provider>,
    notify: () => state.clock.notify(),
    time: () => Math.max(0, beat.frame(state.clock.frame) / state.fps - beat.start),
    hold: (promise: Promise<unknown>) => state.clock.hold(promise),
    register: (render: () => Promise<void>, phase: 'commit' | 'update' | 'draw' = 'update') => { const list = phase === 'draw' ? state.clock.renderers : phase === 'commit' ? state.clock.commits : state.clock.updates; list.add(render); return () => { list.delete(render); }; },
  }), [state, beat]);
}

/** The scene's size, length, fps, brand and media. */
export function useScene(): SceneProps {
  const { width, height, duration, fps, brand, media } = useSceneState();
  return { width, height, duration, fps, brand, media };
}

/**
 * Time inside the nearest beat. With a selector, the component re-renders only when the selected
 * value changes: useBeat(t => t.time > 2) flips once, useBeat(t => Math.floor(t.time * 20)) steps.
 */
export function useBeat(): BeatTime;
export function useBeat<T>(select: (time: BeatTime) => T): T;
export function useBeat<T>(select?: (time: BeatTime) => T): T | BeatTime {
  const { clock, fps } = useSceneState(), beat = useContext(BeatContext)!;
  const cache = useRef<{ frame: number; beat: BeatWindow; start: number; duration: number; value: T | BeatTime } | null>(null);
  const read = () => {
    const cached = cache.current;
    if (cached && cached.frame === clock.frame && cached.beat === beat && cached.start === beat.start && cached.duration === beat.duration) return cached.value;
    const time = beat.frame(clock.frame) / fps - beat.start;
    const now: BeatTime = { time, frame: Math.round(time * fps), fps, start: beat.start, duration: beat.duration, progress: beat.duration > 0 ? Math.min(1, Math.max(0, time / beat.duration)) : 1 };
    const value = select ? select(now) : now;
    // A selected value that did not change keeps its identity, so React skips the re-render.
    cache.current = { frame: clock.frame, beat, start: beat.start, duration: beat.duration, value: select && cached && cached.beat === beat && Object.is(cached.value, value) ? cached.value : value };
    return cache.current.value;
  };
  return useSyncExternalStore(clock.subscribe, read, read);
}

type BeatProps = {
  /** Other beats in the same parent can start relative to this one: start="intro", "intro + 0.5", "intro - 0.3". */
  id?: string;
  /** Seconds on the parent's clock, or a reference to an earlier sibling beat, as HyperFrames' data-start. */
  start?: number | string;
  /** Seconds; the rest of the parent when left out. */
  duration?: number;
  /** Stacking among sibling beats, like data-track-index: higher draws on top. */
  track?: number;
  /** Keep the subtree's DOM (display:none) outside the window, for heavy parts that come back often.
   *  While hidden it costs nothing per frame: no renders, no GSAP seeks; its timelines rebuild when it returns. */
  keep?: boolean;
  style?: React.CSSProperties;
  className?: string;
  children?: React.ReactNode;
};

/**
 * A stretch of the scene with its own clock: useBeat() below it starts at 0 when the beat starts.
 * Outside its window it renders nothing, so offscreen beats cost no DOM and no renders.
 */
export function Beat({ id, start = 0, duration, track = 0, keep = false, style, className, children }: BeatProps) {
  const { clock, fps } = useSceneState(), parent = useContext(BeatContext)!;
  let local: number;
  if (typeof start === 'number') local = start;
  else {
    const parsed = parseStartExpression(start);
    if (!parsed) throw new Error(`Beat start "${start}" is not seconds or a beat reference like "intro + 0.5".`);
    if (parsed.kind === 'absolute') local = parsed.value;
    else {
      const ref = parent.beats.get(parsed.refId);
      if (!ref) throw new Error(`Beat${id ? ` "${id}"` : ''} starts after "${parsed.refId}", but no earlier beat in the same parent has that id.`);
      local = ref.start + ref.duration + parsed.offset;
    }
  }
  const length = Math.max(0, duration ?? parent.duration - local);
  if (id) parent.beats.set(id, { start: local, duration: length });
  const window = useMemo(() => new BeatSpan(parent), [parent]);
  window.local = local;
  window.duration = length;
  const active = useSyncExternalStore(clock.subscribe, () => { const frame = parent.frame(clock.frame); return frame >= Math.round(window.start * fps) && frame < Math.round((window.start + window.duration) * fps); });
  if (!active && !keep) return null;
  const body = (
    <BeatContext.Provider value={window}>
      <div data-beat={id} data-start={local} data-duration={length} data-track-index={track} className={className}
        style={{ position: 'absolute', inset: 0, zIndex: track, ...style }}>{children}</div>
    </BeatContext.Provider>
  );
  // A hidden Activity drops its effects (clock subscriptions, GSAP timelines) and defers its renders,
  // so a kept beat off screen no longer re-renders and seeks its whole subtree on every frame.
  return keep ? <Activity mode={active ? 'visible' : 'hidden'}>{body}</Activity> : body;
}

/**
 * GSAP choreography on the beat's clock: staggers, overlaps, word reveals, SplitText, MorphSVG.
 * `build(tl, el)` runs once per mount, inside a gsap.context scoped to the returned ref's element,
 * so selector strings ('.word') find only this component's nodes and everything it made (tweens,
 * SplitText) is reverted on unmount. The timeline is paused and never ticks: every frame seeks it to
 * the beat's local time, so preview, scrubbing and export draw the same frame. It is seeked to the
 * current frame where it is built, before the frame is captured, so starting states never flash.
 * Animate only nodes React does not restyle on every render (React would overwrite what GSAP set).
 *
 *   const ref = useTimeline((tl, el) => {
 *     const words = new SplitText(el, { type: 'words' }).words;
 *     tl.from(words, { opacity: 0, filter: 'blur(12px)', y: 20, stagger: .08, duration: .7, ease: 'expo.out' }, .2);
 *   });
 *   return <h1 ref={ref}>Every thread, in reach.</h1>;
 */
export function useTimeline<T extends object = HTMLDivElement>(build: (tl: gsap.core.Timeline, el: T) => void, deps: React.DependencyList = []): React.RefObject<T | null> {
  const { clock, fps } = useSceneState(), beat = useContext(BeatContext)!;
  const ref = useRef<T>(null), latest = useRef(build);
  latest.current = build;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) throw new Error('useTimeline needs its ref on an element, such as <div ref={ref}>.');
    if (!gsap) throw new Error('GSAP is not loaded in this scene.');
    const engine = gsap;
    let tl!: gsap.core.Timeline;
    const context = engine.context(() => { tl = engine.timeline({ paused: true }); latest.current(tl, el); }, el instanceof HTMLElement ? el : undefined);
    // Seeked straight from the clock, outside React: the component itself never re-renders per frame.
    const seek = () => { tl.seek(Math.max(0, beat.frame(clock.frame) / fps - beat.start), false); };
    seek();
    const unsubscribe = clock.follow(seek);
    return () => { unsubscribe(); context.revert(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, fps, beat, ...deps]);
  return ref;
}

/** A full-frame layer: an absolutely positioned box covering the scene. */
export function Layer({ style, children, ref, ...rest }: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }) {
  return <div {...rest} ref={ref} style={{ position: 'absolute', inset: 0, ...style }}>{children}</div>;
}

/** Children rendered once and never again, whatever re-renders around them. */
export const Still = memo(function Still({ children }: { children?: React.ReactNode }) { return <>{children}</>; }, () => true);

/** A Lucide icon, like lucide-react: a 24-unit stroked SVG at the requested size. */
export function Icon({ name, size = 24, color = 'currentColor', strokeWidth = 2, fill = 'none', style }: { name: string; size?: number; color?: string; strokeWidth?: number; fill?: string; style?: React.CSSProperties }) {
  const body = useSceneState().icons[name];
  if (body === undefined) throw new Error(`Unknown icon "${name}". Use a Lucide icon name in kebab-case, like 'scissors' or 'chevron-down'.`);
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', ...style }} dangerouslySetInnerHTML={{ __html: body }} />;
}

/** A brand kit blueprint, built once into this box; animate the box, not its parts. */
export function Blueprint({ name, width, height, style }: { name: string; width: number; height: number; style?: React.CSSProperties }) {
  const { blueprint } = useSceneState(), box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { const host = blueprint(name, box.current!, { width, height }); return () => { host.remove(); }; }, [blueprint, name, width, height]);
  return <div ref={box} style={{ position: 'absolute', width, height, ...style }} />;
}

/**
 * A neighbouring beat clip, drawn on its own clock inside a transition clip. Before it starts it holds
 * its first frame; after it ends, its last. The rest of the scene is untouched.
 */
export function Neighbour({ role }: { role: 'from' | 'to' }) {
  const scene = useSceneState();
  const neighbour = scene.neighbours.find(item => item.role === role);
  const offset = neighbour ? Math.round(neighbour.start * scene.fps) : 0, last = neighbour ? Math.max(0, Math.round(neighbour.duration * scene.fps) - 1) : 0;
  const window = useMemo<BeatWindow>(() => ({ start: 0, duration: neighbour?.duration ?? 0, frame: frame => Math.min(last, Math.max(0, frame - offset)), beats: new Map() }), [neighbour, offset, last]);
  const state = useMemo<SceneState>(() => ({ ...scene, duration: neighbour?.duration ?? 0 }), [scene, neighbour]);
  if (!neighbour) throw new Error(`This transition has no "${role}" beat clip next to it. Place it between two React scene clips.`);
  const { Scene } = neighbour, { clock: _clock, icons: _icons, blueprint: _blueprint, neighbours: _neighbours, ...props } = state;
  return <SceneContext.Provider value={state}><BeatContext.Provider value={window}><Scene {...props} /></BeatContext.Provider></SceneContext.Provider>;
}

export type TransitionKind = 'crossfade' | 'blur-through' | 'zoom-into' | 'pull-back';
type TransitionProps = {
  kind?: TransitionKind;
  /** zoom-into / pull-back: the [data-anchor] the camera flies into (in the outgoing beat) or out of (in the incoming one). */
  target?: string;
  /** The point inside the target that lands on `at`, as fractions of its box. */
  origin?: [number, number];
  /** Where on screen that point ends up, as fractions of the frame. */
  at?: [number, number];
  zoom?: number;
  /** The crossfade window, as fractions of the transition. */
  fade?: [number, number];
  ease?: Ease;
};

/**
 * Joins the beat clips on either side, computed from both: a crossfade, a blur through, or a camera
 * move into an anchor of the outgoing beat (zoom-into) or out of one in the incoming beat (pull-back).
 */
export function Transition({ kind = 'crossfade', target, origin = [.5, .5], at = [.5, .5], zoom = 2, fade, ease: curve = 'power3.inOut' }: TransitionProps) {
  const { width, height } = useScene(), { time, duration } = useBeat();
  const camera = kind === 'zoom-into' || kind === 'pull-back';
  const [fadeFrom, fadeTo] = fade ?? (camera ? [.1, .6] : [0, 1]);
  const move = progress(time, 0, duration, curve), mixAmount = progress(time, duration * fadeFrom, duration * (fadeTo - fadeFrom), 'power2.inOut');
  const outgoing = useRef<HTMLDivElement>(null), incoming = useRef<HTMLDivElement>(null);
  // The camera aims at where the anchor is drawn this frame, so the move follows a beat that is still animating.
  useLayoutEffect(() => {
    const layer = kind === 'zoom-into' ? outgoing.current : kind === 'pull-back' ? incoming.current : null;
    if (!layer) return;
    const amount = kind === 'zoom-into' ? move : 1 - move;
    // The camera moves the beat's [data-camera] element (overlays such as captions stay put), or the whole beat.
    const camera = layer.querySelector<HTMLElement>('[data-camera]') ?? layer;
    camera.style.transform = 'none';
    const screen = layer.getBoundingClientRect(), frame = camera.getBoundingClientRect(), anchor = target ? camera.querySelector(`[data-anchor="${CSS.escape(target)}"]`) : null;
    if (target && !anchor) throw new Error(`No element with data-anchor="${target}" in the ${kind === 'zoom-into' ? 'outgoing' : 'incoming'} beat.`);
    const box = anchor?.getBoundingClientRect() ?? frame;
    const x = box.left - frame.left + box.width * origin[0], y = box.top - frame.top + box.height * origin[1], scale = mix(1, zoom, amount);
    const toX = at[0] * width - (frame.left - screen.left), toY = at[1] * height - (frame.top - screen.top);
    camera.style.transformOrigin = '0 0';
    camera.style.transform = `translate(${mix(x, toX, amount) - x * scale}px,${mix(y, toY, amount) - y * scale}px) scale(${scale})`;
  });
  const blur = kind === 'blur-through' ? 16 : 0;
  return <>
    <Layer ref={incoming} style={{ filter: blur ? `blur(${blur * (1 - mixAmount)}px)` : undefined }}><Neighbour role="to" /></Layer>
    <Layer ref={outgoing} style={{ opacity: 1 - mixAmount, filter: blur ? `blur(${blur * mixAmount}px)` : undefined }}><Neighbour role="from" /></Layer>
  </>;
}

/** An easing curve by GSAP name ('expo.out', 'power3.inOut', 'back.out(1.7)', 'steps(4)') or a function. */
export function ease(curve: Ease = 'none'): (progress: number) => number {
  return typeof curve === 'function' ? curve : parseEase(curve);
}

/** Eased 0..1 progress of a window that starts at `start` and lasts `duration` seconds. */
export function progress(time: number, start: number, duration: number, curve: Ease = 'none') {
  if (duration <= 0) return time >= start ? 1 : 0;
  return ease(curve)(Math.min(1, Math.max(0, (time - start) / duration)));
}

export function mix(from: number, to: number, amount: number) { return from + (to - from) * amount; }

/** Piecewise value over time: ramp(t, [0, .6, 2], [0, 1, .4], 'power2.out'). Holds the ends. */
export function ramp(time: number, times: number[], values: number[], curve: Ease = 'none') {
  if (times.length !== values.length || !times.length) throw new Error('ramp needs as many values as times.');
  if (time <= times[0]) return values[0];
  for (let index = 1; index < times.length; index++) {
    if (time < times[index]) return mix(values[index - 1], values[index], progress(time, times[index - 1], times[index] - times[index - 1], curve));
  }
  return values[values.length - 1];
}

/**
 * A damped spring from `from` to `to`, released at time 0, solved in closed form so every frame
 * stands alone (no stepping, so seeking anywhere gives the same value as playing to it).
 */
export function spring(time: number, { from = 0, to = 1, stiffness = 170, damping = 26, mass = 1, velocity = 0 }: { from?: number; to?: number; stiffness?: number; damping?: number; mass?: number; velocity?: number } = {}) {
  if (time <= 0) return from;
  const omega = Math.sqrt(stiffness / mass), zeta = damping / (2 * Math.sqrt(stiffness * mass)), x0 = from - to;
  let x: number;
  if (zeta < 1) {
    const damped = omega * Math.sqrt(1 - zeta * zeta);
    x = Math.exp(-zeta * omega * time) * (x0 * Math.cos(damped * time) + (velocity + zeta * omega * x0) / damped * Math.sin(damped * time));
  } else if (zeta === 1) x = Math.exp(-omega * time) * (x0 + (velocity + omega * x0) * time);
  else {
    const root = Math.sqrt(zeta * zeta - 1), r1 = -omega * (zeta - root), r2 = -omega * (zeta + root), a = (velocity - r2 * x0) / (r1 - r2);
    x = a * Math.exp(r1 * time) + (x0 - a) * Math.exp(r2 * time);
  }
  return to + x;
}

/** Hold the current frame until this settles: the preview and export wait for it before capturing. */
export function waitFor<T>(promise: Promise<T>): Promise<T> {
  pending.push(promise.catch(() => undefined));
  return promise;
}

/** What `import ... from 'revline'` gives a scene. */
export const revline = { useScene, useBeat, useTimeline, Beat, Layer, Still, Icon, Blueprint, Neighbour, Transition, ease, progress, mix, ramp, spring, waitFor };

/** A HyperFrames frame adapter that draws a React scene: seekFrame commits the tree for that frame. */
export function createReactSceneAdapter(options: ReactSceneOptions): FrameAdapter & { settle(): Promise<void> } {
  const clock = new Clock();
  parseEase = options.parseEase;
  gsap = options.gsap;
  const { Scene, root: container, icons, blueprint, neighbours = [], parseEase: _ease, gsap: _gsap, ...props } = options;
  const state: SceneState = { ...props, clock, icons, blueprint, neighbours };
  const scene: BeatWindow = { start: 0, duration: props.duration, frame: same, beats: new Map() };
  let root: Root | null = null, failure: unknown = null;
  const commit = (work: () => void) => {
    failure = null;
    flushSync(work);
    if (failure) throw failure instanceof Error ? failure : new Error(String(failure));
  };
  return {
    id: 'revline-react',
    init: () => {
      root = createRoot(container, { onUncaughtError: error => { failure = error; } });
      commit(() => root!.render(
        <SceneContext.Provider value={state}><BeatContext.Provider value={scene}><Scene {...props} /></BeatContext.Provider></SceneContext.Provider>,
      ));
    },
    getDurationFrames: () => Math.round(props.duration * props.fps),
    seekFrame: frame => {
      commit(() => clock.set(Math.max(0, Math.round(frame))));
      // A beat whose start moved in that render shifts the beats nested in it, which did not re-render:
      // asking again lets them catch up in this frame. Unchanged reads are cached, so this pass is cheap.
      commit(() => clock.notify());
      clock.seek();
    },
    settle: async () => { const waiting = pending; pending = []; await Promise.all(waiting); await clock.settle(); },
    destroy: () => { root?.unmount(); root = null; },
  };
}

export const rendererBridge = { useSceneBridge, useScene };
export const modules = { revline, react: React, 'react/jsx-runtime': ReactJSXRuntime } satisfies SceneRuntimeModules<'react'>;
