// Motion helpers a scene receives next to section(): shot, push, hit, cursor and the music beat readers.
// The code owns the mechanics (eases, overlaps, decay, guards); scene code only chooses properties. Every value is
// a pure function of the timeline's time, so a seek to any frame draws the same picture in preview and export.
//
// Moves that must stack on one element (a shot's entrance, a hit's shake and punch) write their own CSS variable,
// and the element's `translate`, `scale` and `rotate` properties sum them, so no move overwrites another and GSAP's
// own transform (x, y, scale: a push's camera) stays free. Each envelope ease is 0 at both ends, so any move reads
// as rest before it starts and after it ends, whichever way the playhead jumped.
import { gsap } from 'gsap';
import type { SectionHelper } from './scene-runtime';

/** Film seconds of the music beat markers on the timeline (markMusicBeats), per kind. */
export type SceneBeats = { beats: number[]; downbeats: number[]; accents: number[] };
type Target = string | Element;
type Point = Target | { x: number; y: number };
type Direction = 'left' | 'right' | 'up' | 'down';
type ShotEase = 'expo' | 'power4';
export type ShotOptions = {
  /** The shot's container: a selector or element. Defaults to the element with data-shot="<name>". */
  el?: Target;
  enter?: { from?: Direction | 'zoom' | 'none'; overlap?: number; frames?: number; distance?: number; ease?: ShotEase };
  exit?: 'cut' | 'whip' | { type: 'whip'; to?: Direction; frames?: number };
  /** Checks that the shot starts on a music marker of this kind. */
  on?: 'beat' | 'downbeat' | 'accent';
};
export type Shot = { name: string; el: HTMLElement; start: number; duration: number; end: number };
export type ShotHelper = (name: string, start: number, duration: number, options: ShotOptions, build: (tl: gsap.core.Timeline, shot: Shot) => void) => gsap.core.Timeline;
export type PushOptions = { target: Target; amount?: number; frames?: number; ease?: ShotEase; at?: number; center?: number; camera?: Target };
export type HitOptions = { at?: number; intensity?: number; frames?: number; axis?: 'x' | 'y' | 'both'; flash?: boolean | string; punch?: number; target?: Target };
export type CursorOptions = {
  path: Point[]; at?: number; clicks?: 'last' | 'all' | 'none' | number[]; frames?: number; pause?: number; arc?: number; size?: number; color?: string; parent?: Target;
  type?: { el: Target; text: string; cps?: number; caret?: number };
};
export type CursorResult = { el: HTMLElement; end: number; arrivals: number[] };
export type MotionHelpers = {
  shot: ShotHelper;
  push: (tl: gsap.core.Timeline, options: PushOptions) => gsap.core.Timeline;
  hit: (tl: gsap.core.Timeline, options?: HitOptions) => gsap.core.Timeline;
  cursor: (tl: gsap.core.Timeline, options: CursorOptions) => CursorResult;
  beat: (n: number) => number;
  downbeat: (n: number) => number;
  accent: (n: number) => number;
  beats: (kind?: 'beats' | 'downbeats' | 'accents') => number[];
};

const round = (value: number) => Math.round(value * 1000) / 1000;
/** A setting's value: its default when omitted, clamped into its range otherwise. */
function setting(what: string, value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${what} must be a number between ${min} and ${max}.`);
  return Math.min(max, Math.max(min, value));
}
function choice<T extends string>(what: string, value: unknown, fallback: T, options: readonly T[]): T {
  if (value === undefined) return fallback;
  if (!options.includes(value as T)) throw new Error(`${what} must be one of ${options.map(item => `'${item}'`).join(', ')}.`);
  return value as T;
}
const easeOut = (name: ShotEase) => gsap.parseEase(`${name}.out`);
/** 0 at both ends, so before and after the move it adds nothing. */
const envelope = (shape: (t: number) => number) => (t: number) => t <= 0 || t >= 1 ? 0 : shape(t);
/** A deterministic 0..1 value for a seed, so shakes differ from each other but never between renders. */
function seeded(seed: number) {
  let state = (Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9) >>> 0;
  state = Math.imul(state ^ (state >>> 16), 2246822507) >>> 0;
  state = Math.imul(state ^ (state >>> 13), 3266489909) >>> 0;
  return ((state ^ (state >>> 16)) >>> 0) / 4294967296;
}

/** Layout position of an element's center inside an ancestor, ignoring transforms (they move while building). */
function centerIn(el: HTMLElement, ancestor: HTMLElement) {
  const offsets = (node: HTMLElement | null) => { let x = 0, y = 0; for (let at = node; at; at = at.offsetParent as HTMLElement | null) { x += at.offsetLeft + at.clientLeft; y += at.offsetTop + at.clientTop; } return { x, y }; };
  if (el.offsetParent !== null || el === ancestor) {
    const a = offsets(el), b = offsets(ancestor);
    return { x: a.x - b.x - ancestor.clientLeft + el.offsetWidth / 2, y: a.y - b.y - ancestor.clientTop + el.offsetHeight / 2 };
  }
  // SVG and other elements without offsets: measured on screen, scaled back to the ancestor's own pixels.
  const box = el.getBoundingClientRect(), frame = ancestor.getBoundingClientRect(), scale = ancestor.offsetWidth ? frame.width / ancestor.offsetWidth : 1;
  return { x: (box.left + box.width / 2 - frame.left) / scale, y: (box.top + box.height / 2 - frame.top) / scale };
}

export function motionHelpers({ root, fps, width, height, section, beats: markers }: { root: HTMLElement; fps: number; width: number; height: number; section: SectionHelper; beats?: SceneBeats | null }): MotionHelpers {
  const frame = 1 / fps;
  let current: Shot | undefined, previous: { shot: Shot; tl: gsap.core.Timeline; exit: { to?: Direction; frames: number }; tweens: gsap.core.Tween[] } | undefined, ids = 0;

  const element = (target: Target, what: string, scope: HTMLElement = root): HTMLElement => {
    if (target instanceof Element) return target as HTMLElement;
    if (typeof target !== 'string' || !target.trim()) throw new Error(`${what} needs a selector or an element.`);
    const found = scope.querySelector(target) ?? root.querySelector(target);
    if (!found) throw new Error(`${what}: no element matches "${target}".`);
    return found as HTMLElement;
  };

  // Additive channels per element: each move owns CSS variables the element's translate, scale and rotate sum.
  const channels = new WeakMap<HTMLElement, { x: string[]; y: string[]; scale: string[]; rotate: string[] }>();
  const channel = (el: HTMLElement, kind: 'x' | 'y' | 'scale' | 'rotate') => {
    let list = channels.get(el);
    if (!list) channels.set(el, list = { x: [], y: [], scale: [], rotate: [] });
    const name = `--rv-${kind}${++ids}`;
    list[kind].push(name);
    const sum = (names: string[], unit: string, zero: string, join: string) => names.length ? `calc(${names.map(item => `var(${item}, ${zero})`).join(join)})` : `0${unit}`;
    if (list.x.length || list.y.length) el.style.translate = `${sum(list.x, 'px', '0px', ' + ')} ${sum(list.y, 'px', '0px', ' + ')}`;
    if (list.scale.length) el.style.scale = sum(list.scale, '', '1', ' * ');
    if (list.rotate.length) el.style.rotate = sum(list.rotate, 'deg', '0deg', ' + ');
    return name;
  };

  // ---- Music markers -------------------------------------------------------------------------------------------
  const KINDS = { beats: { label: 'beat', call: 'beat' }, downbeats: { label: 'downbeat', call: 'downbeat' }, accents: { label: 'accent', call: 'accent' } } as const;
  const listOf = (kind: keyof SceneBeats) => {
    const list = markers?.[kind] ?? [];
    if (!list.length) throw new Error(`No ${KINDS[kind].label} markers reach this scene. Run markMusicBeats on the song's audio clip with kind '${kind}', so its markers fall inside this clip, then read them with ${KINDS[kind].call}(n).`);
    return list;
  };
  const nth = (kind: keyof SceneBeats) => (n: number) => {
    const list = listOf(kind);
    if (!Number.isInteger(n) || n < 1 || n > list.length) throw new Error(`${KINDS[kind].call}(${n}): this scene has ${list.length} ${KINDS[kind].label} markers, numbered 1 to ${list.length} (${KINDS[kind].call}(1) = ${list[0]}s, ${KINDS[kind].call}(${list.length}) = ${list.at(-1)}s).`);
    return list[n - 1];
  };

  // ---- shot ----------------------------------------------------------------------------------------------------
  const OPPOSITE: Record<Direction, Direction> = { left: 'right', right: 'left', up: 'down', down: 'up' };
  const offsetFor = (direction: Direction, distance: number) => ({ x: direction === 'left' ? -distance * width : direction === 'right' ? distance * width : 0, y: direction === 'up' ? -distance * height : direction === 'down' ? distance * height : 0 });

  /** A whip exit. Without its own `to` it leaves left until the next shot says which side it enters from. */
  const whipOut = (from: Shot, tl: gsap.core.Timeline, exit: { to?: Direction; frames: number }, next?: Direction | 'zoom' | 'none') => {
    const tweens: gsap.core.Tween[] = [];
    const to = exit.to ?? (next && next in OPPOSITE ? OPPOSITE[next as Direction] : 'left');
    const frames = Math.min(exit.frames, Math.floor(from.duration * fps)), travel = offsetFor(to, .55), at = from.duration - frames * frame;
    // Accelerates out to the cut: power4.in, so its last frame is its fastest.
    const accelerate = gsap.parseEase('power4.in');
    for (const axis of ['x', 'y'] as const) if (travel[axis]) { const name = channel(from.el, axis); tweens.push(gsap.fromTo(from.el, { [name]: '0px' }, { [name]: `${travel[axis]}px`, duration: frames * frame, ease: envelope(accelerate), immediateRender: false, paused: true })); }
    for (const tween of tweens) tl.add(tween.paused(false), at);
    return tweens;
  };

  const shot: ShotHelper = (name, start, duration, options, build) => {
    if (typeof build !== 'function') throw new Error(`Shot "${name}" needs a build function: shot('${name}', ${start}, ${duration}, { enter: { from: 'right' } }, (tl, shot) => { ... }).`);
    const opts = options ?? {};
    if (typeof opts !== 'object') throw new Error(`Shot "${name}": the fourth argument is its options, like { enter: { from: 'right' }, exit: 'cut' }.`);
    const el = element(opts.el ?? `[data-shot="${name}"]`, `Shot "${name}" el (give el, or put data-shot="${name}" on its container)`);
    const enter = opts.enter ?? {};
    const from = choice(`Shot "${name}" enter.from`, enter.from, 'none', ['left', 'right', 'up', 'down', 'zoom', 'none'] as const);
    const frames = Math.round(setting(`Shot "${name}" enter.frames`, enter.frames, 14, 6, 40));
    const overlap = Math.round(setting(`Shot "${name}" enter.overlap`, enter.overlap, 4, 0, Math.min(12, frames - 2)));
    const distance = setting(`Shot "${name}" enter.distance`, enter.distance, .3, .05, 1);
    const ease = choice(`Shot "${name}" enter.ease`, enter.ease, 'expo', ['expo', 'power4'] as const);
    const exitType = typeof opts.exit === 'object' && opts.exit ? opts.exit.type : opts.exit;
    const exit = choice(`Shot "${name}" exit`, exitType, 'cut', ['cut', 'whip'] as const);
    const exitTo = typeof opts.exit === 'object' && opts.exit?.to !== undefined ? choice(`Shot "${name}" exit.to`, opts.exit.to, 'left', ['left', 'right', 'up', 'down'] as const) : undefined;
    const exitFrames = Math.round(setting(`Shot "${name}" exit.frames`, typeof opts.exit === 'object' ? opts.exit?.frames : undefined, 5, 2, 12));
    if (opts.on !== undefined) {
      const kind = ({ beat: 'beats', downbeat: 'downbeats', accent: 'accents' } as const)[choice(`Shot "${name}" on`, opts.on, 'beat', ['beat', 'downbeat', 'accent'] as const)];
      const list = listOf(kind), nearest = list.reduce((best, time) => Math.abs(time - start) < Math.abs(best - start) ? time : best, list[0]);
      if (Math.abs(nearest - start) > frame / 2 + 1e-6) throw new Error(`Shot "${name}" starts at ${start}s, which is not on a ${KINDS[kind].label} marker; the nearest is ${KINDS[kind].call}(${list.indexOf(nearest) + 1}) = ${nearest}s. Start it there.`);
    }
    if (current) throw new Error(`Shot "${name}" is inside shot "${current.name}". Shots do not nest.`);
    const handle: Shot = { name, el, start, duration, end: round(start + duration) };
    el.dataset.camera = '';
    // A shot is seen only between its start and end; the next shot's container replaces it at the cut.
    gsap.set(el, { visibility: start <= frame / 2 ? 'visible' : 'hidden' });
    const pending = previous;
    const result = section(name, start, duration, tl => {
      current = handle;
      try {
        if (start > frame / 2) tl.set(el, { visibility: 'visible', x: 0, y: 0, scale: 1, rotation: 0 }, 0);
        tl.set(el, { visibility: 'hidden' }, duration);
        if (from !== 'none') {
          // The entrance began `overlap` frames before the cut (hidden behind the previous shot), so its first frame
          // is already moving. Its ease is the tail of the chosen ease.out from that point: speed carries across.
          const full = easeOut(ease), a = overlap / frames, startsAt = full(a), rest = 1 - startsAt;
          const tail = (t: number) => t <= 0 ? 0 : t >= 1 ? 1 : (full(a + t * (1 - a)) - startsAt) / rest;
          const length = (frames - overlap) * frame;
          if (from === 'zoom') { const name = channel(el, 'scale'); tl.fromTo(el, { [name]: 1 + distance * .5 * rest }, { [name]: 1, duration: length, ease: tail, immediateRender: false }, 0); }
          else {
            const offset = offsetFor(from, distance);
            for (const axis of ['x', 'y'] as const) if (offset[axis]) { const name = channel(el, axis); tl.fromTo(el, { [name]: `${offset[axis] * rest}px` }, { [name]: '0px', duration: length, ease: tail, immediateRender: false }, 0); }
          }
        }
        build(tl, handle);
      } finally { current = undefined; }
    });
    // The previous shot's whip now knows where this one enters from.
    if (pending && !pending.exit.to) { for (const tween of pending.tweens) pending.tl.remove(tween); whipOut(pending.shot, pending.tl, pending.exit, from); }
    if (exit === 'whip') { const out = { to: exitTo, frames: exitFrames }; previous = { shot: handle, tl: result, exit: out, tweens: whipOut(handle, result, out) }; }
    else previous = undefined;
    return result;
  };

  // ---- push ----------------------------------------------------------------------------------------------------
  type Camera = { x: number; y: number; scale: number };
  const pushes = new WeakMap<HTMLElement, { tl: gsap.core.Timeline; start: number; end: number; to: Camera }[]>();
  const push = (tl: gsap.core.Timeline, options: PushOptions) => {
    if (!options || options.target === undefined) throw new Error("push(tl, { target }) needs a target: the element the camera moves toward, like push(tl, { target: '.cta', amount: .15 }).");
    const camera = options.camera !== undefined ? element(options.camera, 'push camera') : current?.el;
    if (!camera) throw new Error('push() outside a shot needs camera: the element that frames the shot (it carries data-camera).');
    const target = element(options.target, 'push target', camera);
    if (options.amount !== undefined && typeof options.amount === 'number' && options.amount < .04) throw new Error(`push amount ${options.amount} is under the .04 minimum: a push that small reads as a stutter, not a move. Push .04 or more, or leave the frame still.`);
    const amount = setting('push amount', options.amount, .15, .04, 1.5);
    const frames = Math.round(setting('push frames', options.frames, Math.round(fps * .8), 6, fps * 4));
    const ease = choice('push ease', options.ease, 'expo', ['expo', 'power4'] as const);
    const center = setting('push center', options.center, 1, 0, 1);
    const at = setting('push at', options.at, 0, 0, 3600), end = at + frames * frame;
    const list = pushes.get(camera) ?? [];
    pushes.set(camera, list);
    const same = list.filter(item => item.tl === tl);
    const clash = same.find(item => at < item.end - 1e-6 && end > item.start + 1e-6);
    if (clash) throw new Error(`This push (${round(at)}s to ${round(end)}s) overlaps the push from ${round(clash.start)}s to ${round(clash.end)}s on the same camera. One push at a time per camera: start it at ${round(clash.end)}s or later, or make the two one bigger push.`);
    if (same.some(item => item.start > at)) throw new Error('Add the pushes on one camera in time order: each push starts where the camera ended up after the previous one.');
    const before = same.reduce<typeof same[number] | undefined>((last, item) => !last || item.end > last.end ? item : last, undefined)?.to ?? { x: 0, y: 0, scale: 1 };
    const point = centerIn(target, camera), box = { width: camera.offsetWidth || width, height: camera.offsetHeight || height };
    const scale = before.scale * (1 + amount);
    // The camera scales about its own center (the default transform origin): a point p shows at c + x + s * (p - c).
    const place = (axis: 'x' | 'y', size: number) => {
      const c = size / 2, p = point[axis], on = c + before[axis] + before.scale * (p - c), wanted = on + (c - on) * center;
      let value = wanted - c - scale * (p - c);
      // The camera keeps covering its frame: no edge of the shot comes into view.
      if (scale >= 1) value = Math.min(c * (scale - 1), Math.max(-c * (scale - 1), value));
      return value;
    };
    const to = { x: place('x', box.width), y: place('y', box.height), scale };
    list.push({ tl, start: at, end, to });
    // Fast start, slow end: ease.out only.
    return tl.fromTo(camera, { x: before.x, y: before.y, scale: before.scale }, { ...to, duration: frames * frame, ease: `${ease}.out`, immediateRender: false }, at);
  };

  // ---- hit -----------------------------------------------------------------------------------------------------
  let hits = 0;
  const hit = (tl: gsap.core.Timeline, options: HitOptions = {}) => {
    const target = options.target !== undefined ? element(options.target, 'hit target') : current?.el ?? root;
    const at = setting('hit at', options.at, 0, 0, 3600);
    const intensity = setting('hit intensity', options.intensity, .5, 0, 1);
    const frames = Math.round(setting('hit frames', options.frames, 10, 3, 30));
    const axis = choice('hit axis', options.axis, 'both', ['x', 'y', 'both'] as const);
    const punch = setting('hit punch', options.punch, .04, 0, .25);
    const seed = ++hits, amplitude = intensity * .035 * Math.min(width, height);
    // Starts half a frame early so the frame at `at` is already the hardest one; lands on rest exactly at at + frames.
    const lead = Math.min(at, frame / 2), length = frames * frame + lead, rise = lead / length;
    const decay = (power: number) => envelope(t => t < rise ? t / rise : Math.pow(1 - (t - rise) / (1 - rise), power));
    const cycles = frames / 2.4, phase = seeded(seed) * Math.PI * 2, wobble = seeded(seed + 101) * Math.PI * 2;
    const wave = (t: number, offset: number, shift: number) => Math.cos(2 * Math.PI * cycles * (t - rise) / (1 - rise) + shift) * .75 + Math.cos(2 * Math.PI * cycles * 1.7 * (t - rise) / (1 - rise) + offset) * .25;
    const shake = decay(2);
    if (amplitude > 0) {
      if (axis !== 'y') { const name = channel(target, 'x'); tl.fromTo(target, { [name]: '0px' }, { [name]: `${amplitude}px`, duration: length, ease: t => shake(t) * wave(t, phase, 0), immediateRender: false }, at - lead); }
      if (axis !== 'x') { const name = channel(target, 'y'); tl.fromTo(target, { [name]: '0px' }, { [name]: `${amplitude * (axis === 'both' ? .7 : 1)}px`, duration: length, ease: t => shake(t) * wave(t, wobble, Math.PI / 2.6), immediateRender: false }, at - lead); }
      if (axis === 'both') { const name = channel(target, 'rotate'); tl.fromTo(target, { [name]: '0deg' }, { [name]: `${intensity * 1.2}deg`, duration: length, ease: t => shake(t) * wave(t, phase + 1, 1.1), immediateRender: false }, at - lead); }
    }
    // Punch-in, plus just enough extra scale that the shake never shows the frame's edge.
    const cover = target === root || target === current?.el ? (2 * amplitude) / Math.min(width, height) : 0, scaleAmount = punch + cover;
    if (scaleAmount > 0) {
      const punchShape = decay(3), coverShape = shake, name = channel(target, 'scale');
      tl.fromTo(target, { [name]: 1 }, { [name]: 1 + scaleAmount, duration: length, ease: t => (punch * punchShape(t) + cover * coverShape(t)) / scaleAmount, immediateRender: false }, at - lead);
    }
    if (options.flash) {
      const flash = document.createElement('div');
      flash.dataset.rvFlash = '';
      flash.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:9999;opacity:0;background:${typeof options.flash === 'string' ? options.flash : '#fff'}`;
      root.appendChild(flash);
      // Exactly one frame, at `at`: the tween spans half a frame either side of it.
      const early = Math.min(at, frame / 2);
      tl.fromTo(flash, { opacity: 0 }, { opacity: .9, duration: early + frame / 2, ease: envelope(() => 1), immediateRender: false }, at - early);
    }
    return tl;
  };

  // ---- cursor --------------------------------------------------------------------------------------------------
  const cursorEase = gsap.parseEase('power3.out');
  // Eases in briefly, then decelerates into the target like a hand settling.
  const travel = (t: number) => t <= 0 ? 0 : t >= 1 ? 1 : cursorEase(t < .12 ? t * t / .24 : (t - .06) / .94);
  const cursor = (tl: gsap.core.Timeline, options: CursorOptions): CursorResult => {
    if (!options || !Array.isArray(options.path) || !options.path.length) throw new Error("cursor(tl, { path }) needs a path: targets or { x, y } points, like cursor(tl, { path: [{ x: 900, y: 700 }, '.signup'], at: .4 }).");
    const parent = options.parent !== undefined ? element(options.parent, 'cursor parent') : current?.el ?? root;
    const at = setting('cursor at', options.at, 0, 0, 3600);
    const pause = Math.round(setting('cursor pause', options.pause, 6, 0, 60)) * frame;
    const arc = setting('cursor arc', options.arc, .12, 0, .4);
    const size = setting('cursor size', options.size, 30, 14, 80);
    const color = typeof options.color === 'string' ? options.color : '#ffffff';
    const points = options.path.map((item, index) => typeof item === 'object' && item !== null && !(item instanceof Element) && 'x' in item
      ? { x: setting(`cursor path[${index}].x`, item.x, 0, -10_000, 10_000), y: setting(`cursor path[${index}].y`, item.y, 0, -10_000, 10_000) }
      : centerIn(element(item as Target, `cursor path[${index}]`, parent), parent));
    const clickAt = new Set(options.clicks === 'none' ? [] : options.clicks === 'all' ? points.map((_, index) => index) : Array.isArray(options.clicks) ? options.clicks : [points.length - 1]);
    for (const index of clickAt) if (!Number.isInteger(index) || index < 0 || index >= points.length) throw new Error(`cursor clicks: ${index} is not a path index (0 to ${points.length - 1}).`);

    const el = document.createElement('div');
    el.dataset.rvCursor = '';
    el.style.cssText = `position:absolute;left:0;top:0;width:${size}px;height:${size}px;pointer-events:none;z-index:9000;transform-origin:0 0`;
    el.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="display:block;overflow:visible;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))"><path d="M0 0 L0 17.5 L4.6 13.4 L7.6 20 L10.6 18.7 L7.7 12.2 L14 12.2 Z" fill="${color}" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    parent.appendChild(el);
    gsap.set(el, { x: points[0].x, y: points[0].y, autoAlpha: 0 });
    tl.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 3 * frame, ease: 'none', immediateRender: false }, at);

    const arcX = channel(el, 'x'), arcY = channel(el, 'y'), press = channel(el, 'scale');
    const arrivals: number[] = [at];
    const click = (time: number, point: { x: number; y: number }) => {
      tl.fromTo(el, { [press]: 1 }, { [press]: .82, duration: 7 * frame, ease: envelope(t => Math.sin(Math.PI * Math.min(1, t * 1.6) ** .8)), immediateRender: false }, time);
      const ripple = document.createElement('div'), radius = size * 1.1;
      ripple.dataset.rvRipple = '';
      ripple.style.cssText = `position:absolute;left:${point.x - radius}px;top:${point.y - radius}px;width:${radius * 2}px;height:${radius * 2}px;border-radius:50%;border:2px solid ${color};background:${color}22;pointer-events:none;z-index:8999;opacity:0`;
      parent.insertBefore(ripple, el);
      gsap.set(ripple, { scale: .2 });
      tl.fromTo(ripple, { scale: .2 }, { scale: 1, duration: 14 * frame, ease: 'power2.out', immediateRender: false }, time + 2 * frame)
        .fromTo(ripple, { opacity: 0 }, { opacity: .9, duration: 14 * frame, ease: envelope(t => Math.pow(1 - t, 1.4)), immediateRender: false }, time + 2 * frame);
      return 9 * frame;
    };
    let time = at + 3 * frame;
    if (clickAt.has(0)) time += click(time, points[0]) + pause;
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1], b = points[index], dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
      const frames = Math.round(setting('cursor frames', options.frames, Math.min(fps * 1.4, Math.max(10, fps * (.32 + distance / 2400))), 6, fps * 3));
      const length = frames * frame;
      tl.fromTo(el, { x: a.x, y: a.y }, { x: b.x, y: b.y, duration: length, ease: travel, immediateRender: false }, time);
      // A slight bow to one side of the straight line, gone by arrival.
      if (distance > 1 && arc > 0) {
        const side = dx >= 0 ? -1 : 1, bow = distance * arc;
        const shape = envelope(t => Math.sin(Math.PI * travel(t)));
        tl.fromTo(el, { [arcX]: '0px' }, { [arcX]: `${(-dy / distance) * bow * side}px`, duration: length, ease: shape, immediateRender: false }, time)
          .fromTo(el, { [arcY]: '0px' }, { [arcY]: `${(dx / distance) * bow * side}px`, duration: length, ease: shape, immediateRender: false }, time);
      }
      time += length;
      arrivals.push(round(time));
      if (clickAt.has(index)) time += click(time, b);
      if (index < points.length - 1) time += pause;
    }

    if (options.type) {
      const field = element(options.type.el, 'cursor type.el', parent);
      const text = String(options.type.text ?? '');
      if (!text) throw new Error('cursor type.text needs the text to type.');
      const cps = setting('cursor type.cps', options.type.cps, 14, 4, 40), hold = setting('cursor type.caret', options.type.caret, 1, 0, 10);
      // Each character is its own span, shown at its own time: seek-safe without callbacks.
      const hint = document.createElement('span'), typed = document.createElement('span'), caret = document.createElement('span');
      hint.innerHTML = field.innerHTML;
      field.innerHTML = '';
      typed.style.whiteSpace = 'pre-wrap';
      const chars = Array.from(text).map(char => { const span = document.createElement('span'); span.textContent = char; span.style.display = 'none'; typed.appendChild(span); return span; });
      field.appendChild(hint); field.appendChild(typed); field.appendChild(caret);
      caret.style.cssText = 'display:inline-block;width:.08em;min-width:2px;height:1.05em;margin-left:.04em;vertical-align:-.12em;background:currentColor;opacity:0';
      const start = time + 2 * frame, typing = Math.max(frame, chars.length / cps), total = typing + hold;
      tl.set(hint, { display: 'none' }, start);
      chars.forEach((span, index) => tl.set(span, { display: 'inline' }, start + index / cps));
      // Solid while typing, then blinks every 0.53 s until the hold ends.
      tl.fromTo(caret, { opacity: 0 }, { opacity: 1, duration: total, ease: envelope(t => { const seconds = t * total; return seconds < typing || Math.floor((seconds - typing) / .53) % 2 === 0 ? 1 : 0; }), immediateRender: false }, start);
      time = start + total;
    }
    return { el, end: round(time), arrivals };
  };

  return { shot, push, hit, cursor, beat: nth('beats'), downbeat: nth('downbeats'), accent: nth('accents'), beats: (kind = 'beats') => [...listOf(choice('beats(kind)', kind, 'beats', ['beats', 'downbeats', 'accents'] as const))] };
}
