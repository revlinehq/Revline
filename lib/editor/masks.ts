import { motionEase, isMotionEasing, type MotionEasing } from './motion-path';
import type { Clip } from './types';

/**
 * A clip mask: a rectangle, ellipse, freehand polygon or text shape that hides the rest of a video or
 * image clip, with a soft (feathered) edge and optional inversion. Geometry is in canvas fractions of the
 * clip's frame (center x/y, width/height), keyed in the clip's motion path time so trims keep it aligned.
 * Drawn as a CSS mask from an SVG, by one runtime shared by preview and export.
 */
export const MASK_SHAPES = ['rectangle', 'ellipse', 'polygon', 'text'] as const;
export type MaskShape = typeof MASK_SHAPES[number];
export type MaskGeometry = { x: number; y: number; width: number; height: number; rotation: number; feather: number };
export type MaskKey = MaskGeometry & { time: number };
export type ClipMask = { shape: MaskShape; invert?: boolean; radius?: number; points?: number[][]; text?: string; active?: { start: number; end: number }; keys: MaskKey[] };
export type MaskAnchor = MaskKey & { easing?: MotionEasing };

const GEOMETRY = ['x', 'y', 'width', 'height', 'rotation', 'feather'] as const;
const LIMITS: Record<typeof GEOMETRY[number], [number, number]> = { x: [-1, 2], y: [-1, 2], width: [.005, 4], height: [.005, 4], rotation: [-360, 360], feather: [0, 200] };

export function validateMask(clip: Pick<Clip, 'kind'> & { mask?: ClipMask }) {
  const mask = clip.mask;
  if (!mask) return;
  if (clip.kind !== 'video' && clip.kind !== 'image') throw new Error('Masks apply to video or image clips.');
  if (!MASK_SHAPES.includes(mask.shape)) throw new Error('Choose a rectangle, ellipse, polygon or text mask.');
  if (mask.active && (!Number.isFinite(mask.active.start) || !Number.isFinite(mask.active.end) || mask.active.end <= mask.active.start)) throw new Error('The tracked mask needs a finite visible range.');
  if (!mask.keys?.length) throw new Error('A mask needs at least one key.');
  mask.keys.forEach((key, index) => {
    if (!Number.isFinite(key.time) || index > 0 && key.time <= mask.keys[index - 1].time) throw new Error('Mask keys need increasing times.');
    for (const property of GEOMETRY) { const [min, max] = LIMITS[property]; if (!Number.isFinite(key[property]) || key[property] < min || key[property] > max) throw new Error(`Mask ${property} must be between ${min} and ${max}.`); }
  });
  if (mask.radius !== undefined && (!Number.isFinite(mask.radius) || mask.radius < 0 || mask.radius > .5)) throw new Error('Mask corner radius must be between 0 and 0.5.');
  if (mask.shape === 'polygon' && (!mask.points || mask.points.length < 3 || mask.points.length > 64 || mask.points.some(point => point.length !== 2 || point.some(value => !Number.isFinite(value) || value < 0 || value > 1)))) throw new Error('A polygon mask needs 3 to 64 points, each [x, y] within 0..1 of its box.');
  if (mask.shape === 'text' && (!mask.text?.trim() || mask.text.length > 40)) throw new Error('A text mask needs 1 to 40 characters.');
}

export function maskAt(keys: MaskKey[], time: number): MaskGeometry {
  const after = keys.findIndex(key => key.time >= time);
  if (after <= 0) return keys[after === -1 ? keys.length - 1 : 0];
  const a = keys[after - 1], b = keys[after], mix = (time - a.time) / (b.time - a.time);
  return Object.fromEntries(GEOMETRY.map(property => [property, a[property] + (b[property] - a[property]) * mix])) as MaskGeometry;
}

/** Bake 1–9 eased anchors (clip-local seconds) into linear keys in path time. */
export function bakeMaskAnchors(anchors: MaskAnchor[], offset = 0): MaskKey[] {
  if (!anchors.length || anchors.length > 9) throw new Error('Use 1 to 9 mask anchors.');
  anchors.forEach((anchor, index) => {
    if (!Number.isFinite(anchor.time) || anchor.time < 0 || index > 0 && anchor.time <= anchors[index - 1].time) throw new Error('Mask anchors need increasing, nonnegative times.');
    if (anchor.easing !== undefined && !isMotionEasing(anchor.easing)) throw new Error('Choose a supported easing, or a cubic-bézier [x1, y1, x2, y2].');
  });
  const strip = ({ easing: _easing, ...key }: MaskAnchor): MaskKey => ({ ...key, time: key.time + offset });
  const keys: MaskKey[] = [strip(anchors[0])];
  for (let index = 1; index < anchors.length; index++) {
    const from = anchors[index - 1], to = anchors[index], easing = to.easing ?? 'linear', steps = easing === 'linear' ? 1 : 24;
    for (let step = 1; step <= steps; step++) {
      const progress = motionEase(step / steps, easing), key = { time: from.time + (to.time - from.time) * step / steps + offset } as MaskKey;
      for (const property of GEOMETRY) key[property] = from[property] + (to[property] - from[property]) * progress;
      keys.push(key);
    }
  }
  return keys;
}

const escape = (value: string) => value.replace(/[<>&"']/g, char => `&#${char.charCodeAt(0)};`);

/** The SVG (frame pixels) whose alpha is the mask at one moment. */
export function maskSvg(mask: ClipMask, geometry: MaskGeometry, width: number, height: number) {
  const w = geometry.width * width, h = geometry.height * height, cx = geometry.x * width, cy = geometry.y * height, left = cx - w / 2, top = cy - h / 2;
  const feather = geometry.feather * height / 1080, rotate = geometry.rotation ? ` transform="rotate(${geometry.rotation} ${cx} ${cy})"` : '';
  const fill = mask.invert ? 'black' : 'white';
  let shape: string;
  if (mask.shape === 'ellipse') shape = `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="${fill}"${rotate}/>`;
  else if (mask.shape === 'polygon') shape = `<polygon points="${mask.points!.map(([x, y]) => `${left + x * w},${top + y * h}`).join(' ')}" fill="${fill}"${rotate}/>`;
  else if (mask.shape === 'text') shape = `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="Inter,Arial Black,Arial,sans-serif" font-weight="900" font-size="${h}" textLength="${w}" lengthAdjust="spacingAndGlyphs" fill="${fill}"${rotate}>${escape(mask.text ?? '')}</text>`;
  else { const r = (mask.radius ?? 0) * Math.min(w, h); shape = `<rect x="${left}" y="${top}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}"${rotate}/>`; }
  const blur = feather > .01 ? `<filter id="f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${feather.toFixed(2)}"/></filter>` : '';
  const background = mask.invert ? `<rect width="${width}" height="${height}" fill="white"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${blur}<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">${background}<g${blur ? ' filter="url(#f)"' : ''}>${shape}</g></mask></defs><rect width="${width}" height="${height}" fill="black" mask="url(#m)"/></svg>`;
}

export type MaskSource = { id: string; index: number; start: number; duration: number; motionOffset: number; mask: ClipMask };
export const maskSources = (clips: Clip[]): MaskSource[] => clips.flatMap((clip, index) => clip.mask && (clip.kind === 'video' || clip.kind === 'image') ? [{ id: clip.id, index, start: clip.start, duration: clip.duration, motionOffset: clip.motionOffset ?? 0, mask: clip.mask }] : []);
export type MaskController = { setSources(sources: MaskSource[]): void; dispose(): void };

/** Paint every masked clip's frame on the shared composition clock (preview and export). */
export function installClipMasks(initial: MaskSource[]): MaskController {
  type Clock = { time(): number; render: (...args: unknown[]) => unknown; eventCallback(name: string, callback?: () => void): unknown; __hfReal?: Clock };
  const host = window as unknown as { __timelines: { revline: Clock }; __revlineMaskController?: MaskController };
  const clock = host.__timelines.revline.__hfReal ?? host.__timelines.revline, composition = document.getElementById('composition')!;
  let sources = initial;
  const painted = new Map<string, string>();
  function clear(node: HTMLElement) { node.style.removeProperty('mask-image'); node.style.removeProperty('-webkit-mask-image'); }
  function paint() {
    const time = clock.time(), width = Number(composition.dataset.width), height = Number(composition.dataset.height);
    for (const source of sources) {
      const node = document.getElementById(`clip-${source.index}-frame`);
      if (!node) continue;
      if (time < source.start || time >= source.start + source.duration) continue;
      const local = time - source.start + source.motionOffset;
      const active = !source.mask.active || local >= source.mask.active.start && local < source.mask.active.end;
      const svg = active ? maskSvg(source.mask, maskAt(source.mask.keys, local), width, height) : `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`;
      if (painted.get(source.id) === svg) continue;
      painted.set(source.id, svg);
      const url = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
      for (const property of ['mask-image', '-webkit-mask-image']) node.style.setProperty(property, url);
      for (const property of ['mask-size', '-webkit-mask-size']) node.style.setProperty(property, '100% 100%');
      for (const property of ['mask-repeat', '-webkit-mask-repeat']) node.style.setProperty(property, 'no-repeat');
    }
  }
  const originalRender = clock.render, originalUpdate = clock.eventCallback('onUpdate') as (() => void) | null;
  const render: Clock['render'] = function (...args) { const result = originalRender.apply(clock, args); paint(); return result; };
  const update = () => { originalUpdate?.(); paint(); };
  clock.render = render; clock.eventCallback('onUpdate', update);
  const controller: MaskController = {
    setSources(next) {
      const wanted = new Set(next.map(source => source.index));
      for (const source of sources) if (!wanted.has(source.index)) { const node = document.getElementById(`clip-${source.index}-frame`); if (node) clear(node); }
      sources = next; painted.clear(); paint();
    },
    dispose() { if (clock.render === render) clock.render = originalRender; clock.eventCallback('onUpdate', originalUpdate ?? undefined); },
  };
  host.__revlineMaskController = controller;
  paint();
  return controller;
}
