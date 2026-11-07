// whip(): the film whip recipe (launch-films-motions page shot-changes) as a scene helper, so films stop hand-rolling it.
// The outgoing shot accelerates out (power4.in), the incoming one arrives already moving the same
// way and settles (expo.out), and an SVG blur along the whip's axis peaks at the cut and is 0 on
// the last frame. Shots stay where they are composed: each shot is wrapped once in a layer that
// takes its place, and only that layer moves and blurs, so the shot's own GSAP transforms and
// filters are untouched (GSAP resets CSS translate/scale on elements it transforms).
import type { gsap as GsapInstance } from 'gsap';
import { WHIP_BLUR_MAX, WHIP_DIRECTIONS, WHIP_FRAMES, WHIP_TRAVEL, type WhipDirection } from './types';
import { whipFrame, whipPeakBlur, whipSpan, type WhipPlacement } from './whip';

export type { WhipDirection };
type Targets = Element | string | ArrayLike<Element>;
export type WhipOptions = {
  /** The outgoing shot: an element, a selector inside root, or a list. Hidden at the cut. */
  out: Targets;
  /** The incoming shot, hidden in its markup until the cut; whip() shows it at the cut, already moving. */
  in: Targets;
  /** The cut, in the given timeline's seconds (film seconds on tl, section seconds on a section's tl). */
  at: number;
  direction?: WhipDirection;
  /** Frames in motion, counted at 30 fps: 3–6, default 4. */
  frames?: number;
  /** Share of the frame the picture travels (left/right: width, up/down: height; zoom: 0.15 scales to 1.25): 0.1–0.25, default 0.15. */
  travel?: number;
  /** Peak blur in px at 1080p at the cut: true (24 for slides, 10 for zooms), false for none, or 0–48. */
  blur?: boolean | number;
  /** Keep the shot not in front visible underneath, filling the edge the front one uncovers, as the footage whip does. For opaque full-frame shots. */
  fill?: boolean;
};
export type WhipHelper = (tl: gsap.core.Timeline, options: WhipOptions) => gsap.core.Timeline;

const DIRECTIONS: readonly WhipDirection[] = WHIP_DIRECTIONS;
const SVG = 'http://www.w3.org/2000/svg';
// Shared across helpers: a blueprint's whips live in the same document as its scene's.
let filterCount = 0;

/** `film` is the scene's tl; `sectionStarts` maps each section's tl to its film start. */
export function whipHelper(g: typeof GsapInstance, film: gsap.core.Timeline, sectionStarts: WeakMap<gsap.core.Timeline, number>, root: HTMLElement, width: number, height: number, fps: number, filmDuration: number): WhipHelper {
  const layers = new WeakMap<HTMLElement, HTMLElement>();
  let filters: SVGSVGElement | undefined;
  const resolve = (targets: Targets, name: string): HTMLElement[] => {
    const list = typeof targets === 'string' ? Array.from(root.querySelectorAll(targets)) : targets instanceof Element ? [targets] : Array.from(targets ?? []);
    if (!list.length || list.some(el => !(el instanceof HTMLElement))) throw new Error(`whip() needs ${name}: an HTML element, a selector inside root, or a list of them.`);
    return list as HTMLElement[];
  };
  const checkShot = (el: HTMLElement) => {
    if (layers.has(el)) return;
    const position = getComputedStyle(el).position;
    if (!el.parentElement || !['absolute', 'fixed'].includes(position) || (position === 'absolute' && el.offsetParent !== el.parentElement)) {
      throw new Error('whip() shots are position:absolute layers whose parent is positioned (the stage). Hide a shot with visibility or opacity, not display:none.');
    }
  };
  return (tl, options) => {
    if (!options || typeof options !== 'object') throw new Error("whip() needs options: whip(tl, { out, in, at, direction }).");
    const base = tl === film ? 0 : sectionStarts.get(tl);
    if (base === undefined) throw new Error('whip(tl, {...}) takes the scene\'s tl or the tl a section() build receives.');
    const { direction = 'left', frames = WHIP_FRAMES.default, travel = WHIP_TRAVEL.default, blur = true, fill = false, at } = options;
    if (!DIRECTIONS.includes(direction)) throw new Error(`whip() direction must be one of ${DIRECTIONS.join(', ')}.`);
    if (!Number.isInteger(frames) || frames < WHIP_FRAMES.min || frames > WHIP_FRAMES.max) throw new Error(`whip() frames must be a whole number from ${WHIP_FRAMES.min} to ${WHIP_FRAMES.max} (30 fps frames).`);
    if (!Number.isFinite(travel) || travel < WHIP_TRAVEL.min || travel > WHIP_TRAVEL.max) throw new Error(`whip() travel is a share of the frame from ${WHIP_TRAVEL.min} to ${WHIP_TRAVEL.max} (0.15 is 15%).`);
    if (typeof fill !== 'boolean') throw new Error('whip() fill is true or false.');
    if (typeof blur === 'number' && (!Number.isFinite(blur) || blur < 0 || blur > WHIP_BLUR_MAX)) throw new Error(`whip() blur is true, false or 0 to ${WHIP_BLUR_MAX} px.`);
    if (!Number.isFinite(at)) throw new Error('whip() needs at: the cut, in seconds.');
    const outs = resolve(options.out, 'out'), ins = resolve(options.in, 'in');
    if (outs.some(el => ins.includes(el))) throw new Error('whip() out and in must be different shots.');
    const zoom = direction === 'zoom' || direction === 'zoom-out';
    // The motion itself comes from whip.ts, shared with the footage whip-pan.
    const params = { direction, frames, fps, travel, blur: blur === false ? 0 : blur === true ? undefined : blur };
    const peak = whipPeakBlur(params), { f, before, after } = whipSpan(frames, fps);
    // The cut lands on the film's frame grid, so the visibility switches and the motion agree on every frame.
    const cut = Math.round((base + at) * fps) / fps, start = cut - before, end = cut + after;
    if (start - f < -1e-6) throw new Error(`whip() at ${at} starts before the film: leave ${(before + f).toFixed(3)} s before the cut.`);
    if (end > filmDuration + 1e-6) throw new Error(`whip() at ${at} runs past the film's end: leave ${after.toFixed(3)} s after the cut.`);
    // Validate every shot before changing the DOM, so a failed call leaves the scene as it was.
    [...outs, ...ins].forEach(checkShot);

    // One blur per whip, along the whip's axis only (both axes for zooms), in one shared svg.
    if (!filters) {
      filters = document.createElementNS(SVG, 'svg');
      filters.setAttribute('width', '0'); filters.setAttribute('height', '0'); filters.setAttribute('aria-hidden', 'true'); filters.style.position = 'absolute';
      root.appendChild(filters);
    }
    const id = `revline-whip-${++filterCount}`, filter = document.createElementNS(SVG, 'filter'), gauss = document.createElementNS(SVG, 'feGaussianBlur');
    filter.id = id; for (const [key, value] of [['x', '-50%'], ['y', '-50%'], ['width', '200%'], ['height', '200%'], ['color-interpolation-filters', 'sRGB']]) filter.setAttribute(key, value);
    gauss.setAttribute('stdDeviation', '0 0'); filter.appendChild(gauss); filters.appendChild(filter);

    // Each shot is wrapped once in a layer filling its containing block, so it keeps its exact position and size.
    const rootBox = root.getBoundingClientRect(), scaleX = rootBox.width ? width / rootBox.width : 1, scaleY = rootBox.height ? height / rootBox.height : 1;
    const layerOf = (el: HTMLElement) => {
      const existing = layers.get(el);
      if (existing) return existing;
      const parent = el.parentElement!, layer = document.createElement('div'), box = parent.getBoundingClientRect(), z = getComputedStyle(el).zIndex;
      layer.dataset.whipLayer = '';
      // Zooms scale around the frame's center.
      layer.style.cssText = `position:absolute;inset:0;pointer-events:none;transform-origin:${width / 2 - (box.left - rootBox.left) * scaleX}px ${height / 2 - (box.top - rootBox.top) * scaleY}px${z !== 'auto' ? `;z-index:${z}` : ''}`;
      parent.insertBefore(layer, el); layer.appendChild(el); layers.set(el, layer);
      return layer;
    };
    const outLayers = outs.map(layerOf), inLayers = ins.map(layerOf);

    // Each rendered frame writes whipFrame() at that time onto the layers: linear time in, so any seek lands on the
    // same values. The shots' own visibility switches are timeline sets, which GSAP reverts when seeking back.
    const k = height / 1080, origin = new Map([...outLayers, ...inLayers].map(layer => [layer, layer.style.zIndex]));
    const place = (layer: HTMLElement, at: WhipPlacement) => { layer.style.transform = zoom ? `scale(${at.scale})` : `translate(${Math.round(at.x * width * 1e4) / 1e4}px, ${Math.round(at.y * height * 1e4) / 1e4}px)`; };
    const apply = (raw: number) => {
      // The scene runtime seeks 0.1 ms after each frame; sample the whip on the frame itself, as footage does,
      // or the steep start of the incoming ease lands about 1% off.
      const t = Math.round((cut + raw) * fps) / fps - cut;
      const frame = whipFrame(params, t), inside = t > -before - 1e-6 && t < after - 1e-6;
      outLayers.forEach(layer => place(layer, frame.out)); inLayers.forEach(layer => place(layer, frame.in));
      gauss.setAttribute('stdDeviation', `${(frame.blur.x * k).toFixed(2)} ${(frame.blur.y * k).toFixed(2)}`);
      for (const layer of [...outLayers, ...inLayers]) {
        layer.style.filter = inside && peak > 0 ? `url(#${id})` : '';
        // With fill, the front shot is drawn on top of the one underneath.
        layer.style.zIndex = fill && inside ? String(frame.front === 'out' ? (outLayers.includes(layer) ? 2 : 1) : (inLayers.includes(layer) ? 2 : 1)) : origin.get(layer)!;
      }
    };
    // The clock starts and ends on a rest frame, so seeking to either side of the whip leaves both shots at rest.
    const clock = { t: -before - f };
    film.fromTo(clock, { t: -before - f }, { t: after, duration: before + f + after, ease: 'none', immediateRender: false, onUpdate: () => apply(clock.t) }, start - f);
    // Without fill only the front shot shows: the outgoing one until the cut, the incoming one from it.
    // With fill both show through the whip, the incoming one underneath from the first frame in motion.
    film.set(ins, { autoAlpha: 1 }, fill ? start : cut).set(outs, { autoAlpha: 0 }, fill ? end : cut);
    return film;
  };
}
