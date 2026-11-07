// Text motion for scene code: reveal, exit, swap, counter, type and mark. Scene code chooses the properties;
// these functions own the mechanics that are easy to get wrong by hand: splitting without a layout jump, staggers
// on whole frames, blur that ends at exactly 0, nothing visible before `at`, fixed-width digits and measured
// marks. Every value is computed while the scene builds or from the seeked time, so preview and export match.
//
// Ranges and defaults come from Sol's frame measurements of ten launch films (~/text-motion-study, catalog.md and
// measurements/). Distances there are pixels of the source frame; they are stored here in em, using the measured
// text height of the same element as 1 em. Durations are stored in seconds and converted to whole frames at the
// film's fps, so a default reads the same at 24, 30 or 60 fps.
import { gsap } from 'gsap';

type Timeline = gsap.core.Timeline;
type Range = readonly [number, number];
/** A distance: a number is em of the element's font size; '24px' or '0.5em' strings also work. */
export type TextLength = number | `${number}px` | `${number}em`;
export type TextSplit = 'chars' | 'words' | 'lines';
export type TextEdge = 'left' | 'right' | 'top' | 'bottom';
/** The properties a reveal starts from or an exit ends at. `true` uses the property's default. */
export type TextMotionProps = { y?: TextLength | true; x?: TextLength | true; scale?: number | true; blur?: TextLength | true; clip?: TextEdge | true; rotate?: number | true; opacity?: number | true };
type Common = { frames?: number; ease?: string; at?: number; tl?: Timeline };
export type RevealOptions = Common & { split?: TextSplit; from?: TextMotionProps; stagger?: number; feather?: TextLength };
export type ExitOptions = Common & { split?: TextSplit; to?: TextMotionProps; stagger?: number; feather?: TextLength };
export type SwapOptions = Common & { direction?: 'up' | 'down' | 'left' | 'right' | 'flip'; overlap?: number; width?: 'animate' | 'hold'; clip?: boolean; blur?: TextLength };
export type CounterFormat = { prefix?: string; suffix?: string; decimals?: number; separator?: string } | ((value: number) => string);
export type CounterOptions = Common & { format?: CounterFormat; roll?: boolean };
export type TypeOptions = Omit<Common, 'frames' | 'ease'> & { cps?: number; caret?: boolean | { color?: string; width?: TextLength }; mistakes?: number; seed?: number; hold?: number; blink?: number };
export type MarkOptions = Common & { style?: 'underline' | 'highlight' | 'box'; from?: 'left' | 'right' | 'center'; color?: string; thickness?: TextLength; offset?: TextLength };
export type TextMotion = {
  reveal: (el: Element | string, options?: RevealOptions) => Timeline;
  exit: (el: Element | string, options?: ExitOptions) => Timeline;
  swap: (el: Element | string, text: string, options?: SwapOptions) => Timeline;
  counter: (el: Element | string, from: number, to: number, options?: CounterOptions) => Timeline;
  type: (el: Element | string, text: string, options?: TypeOptions) => Timeline;
  mark: (el: Element | string, options?: MarkOptions) => Timeline;
};

/** Each property's default and allowed range, with the measurement behind it. */
export const TEXT_MOTION_RANGES = {
  reveal: {
    // 01-firecrawl f8–f45: the shared line settles in 37f @60 fps on expo.out. Shortest entrance: the 10-deepusleepy
    // hinge, 7f @60 (f1228–f1235); longest: 01-firecrawl phrase growth, 50f @60 (f317–f367).
    seconds: { default: 37 / 60, range: [7 / 60, 50 / 60] as Range }, ease: 'expo.out',
    // Words: 01-firecrawl onsets f8/16/24 (8f @60). Lines: 02-firecrawl f12/29/46 (17f @60, the longest). Chars:
    // 01-firecrawl's prompt adds one character every 2f @60 (49 chars over f465–f563).
    stagger: { chars: 2 / 60, words: 8 / 60, lines: 17 / 60, range: [0, 17 / 60] as Range },
    // 01-firecrawl rises 67px on 83px text (0.8 em). Largest: 02-firecrawl's line cascade, 138px on 115px (1.2 em).
    y: { default: 0.8, range: [-1.2, 1.2] as Range },
    // 02-firecrawl f282–f296: "known" carries 23px on 164px text (0.14 em). No larger x was measured; x shares y's bound.
    x: { default: 0.14, range: [-1.2, 1.2] as Range },
    // 01-firecrawl f317–f367: the phrase grows 852→1046px (from 0.81). Range: the 10-deepusleepy hinge starts at
    // scaleY 0.156; the 01-firecrawl pulse returns to 1.23× its minimum (f303–f316).
    scale: { default: 0.81, range: [0.15, 1.25] as Range },
    // 04-rerun f210–f221: letters resolve from 8px blur on 48px letters (0.17 em). Most: the 01-firecrawl label
    // exit, 6px on 32px (0.19 em); 0.2 em is the bound.
    blur: { default: 0.17, range: [0, 0.2] as Range },
    // Not measured: every studied film keeps text upright (rotation ≈ 0° in all 26 patterns). The bound is a guard.
    rotate: { default: 4, range: [-8, 8] as Range },
    // 01-firecrawl f376–f385: the qualifier starts at ~0.07 contrast; a from-opacity of 0 is the default.
    opacity: { default: 0, range: [0, 1] as Range },
    // 03-firecrawl f635–f643 and 01-firecrawl f641–f680: both soft edges travel left to right. Feather: 90–105px on
    // the 66px wordmark, about 1 em; 03-firecrawl f12–f20's shape uncover is a hard edge (0).
    clip: { default: 'left' as TextEdge }, feather: { default: 1, range: [0, 1.5] as Range },
  },
  exit: {
    // 01-firecrawl f114–f136: the headline lifts 50px on 83px text (0.6 em) in 22f @60 on power1.in, as one block.
    seconds: { default: 22 / 60, range: [7 / 60, 50 / 60] as Range }, ease: 'power1.in', stagger: { default: 0 },
    y: { default: -0.6 },
    // 01-firecrawl f1272–f1290: the label defocuses 0→6px on 32px text (0.19 em) while contrast falls to 0.04.
    blur: { default: 0.19 }, opacity: { default: 0 },
  },
  swap: {
    // 10-deepusleepy f1767–f1783: the time line rolls one 170px slot in 16f @60 on power4.out; both lines move
    // together (overlap 1). Shortest: the same film's hinge, 7f @60 (f1228–f1235); longest: the 24f roll window.
    seconds: { default: 16 / 60, range: [7 / 60, 24 / 60] as Range }, ease: 'power4.out',
    overlap: { default: 1, range: [0, 1] as Range },
    // 10-deepusleepy f1768: a 38px shutter blur on the 170px slot (0.22 em) on its first fast frame. Default none.
    blur: { default: 0, range: [0, 0.22] as Range },
  },
  counter: {
    // 02-firecrawl f208–f252: 365,060 → 400,000 in 44f @60 on sine.inOut. Shortest: the 07-krea digit column,
    // 9f @60 (f822–f831); longest: the whole 02-firecrawl count window, 75f @60 (f207–f282).
    seconds: { default: 44 / 60, range: [9 / 60, 75 / 60] as Range }, ease: 'sine.inOut',
  },
  type: {
    // 01-firecrawl f465–f563: 49 characters in 98f @60, 30 per second; the full phrase holds 37f (f563–f600).
    // The cps bound is a guard around that one measurement. Caret: 26–27px tall on the 30px glyph strip (0.9 em).
    cps: { default: 30, range: [10, 60] as Range }, hold: { default: 37 / 60, range: [0, 2] as Range },
    mistakes: { default: 0, range: [0, 3] as Range }, caretHeight: 0.9, caretWidth: { default: 0.06, range: [0.02, 0.2] as Range },
    // Blink is not measured (the source caret is solid while typing); 0 keeps it solid, a value is frames per half cycle.
    blink: { default: 0, range: [0, 60] as Range },
  },
  mark: {
    // 06-rightnow f1302–f1336: the rule grows 28→325px from its left end in 34f @60 on power2.out; the window is 80f.
    seconds: { default: 34 / 60, range: [9 / 60, 80 / 60] as Range }, ease: 'power2.out',
    // The rule is 3px under 62px caption text (0.05 em), 19px below the baseline (about 0.08 em under the line box).
    thickness: { default: 0.05, range: [0.02, 0.2] as Range }, offset: { default: 0.08, range: [-0.3, 0.5] as Range },
  },
} as const;

const clamp = (value: number, [min, max]: Range) => Math.min(max, Math.max(min, value));
const num = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function resolveEl(el: Element | string, root: HTMLElement, name: string): HTMLElement {
  const found = typeof el === 'string' ? root.querySelector(el) : el;
  if (!(found instanceof HTMLElement)) throw new Error(`${name}() needs an element or a selector that matches one${typeof el === 'string' ? `; "${el}" matched nothing` : ''}.`);
  if (!found.isConnected) throw new Error(`${name}() needs an element that is already in the scene: append it to root first, then call ${name}().`);
  return found;
}

function fontSize(el: HTMLElement) { return Number.parseFloat(getComputedStyle(el).fontSize) || 16; }

/** A length in px from em/px input, clamped in em. `true` and undefined use the default. */
function length(value: TextLength | true | undefined, size: number, fallback: number, range?: Range) {
  let em = fallback;
  if (typeof value === 'number' && Number.isFinite(value)) em = value;
  else if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) em = value.trim().endsWith('px') ? parsed / size : parsed;
  }
  return (range ? clamp(em, range) : em) * size;
}

/** Position, layout untransformed: offsets summed to the page, so transforms (a camera, an earlier tween) do not count. */
function pageOffset(node: HTMLElement) {
  let x = 0, y = 0;
  for (let current: HTMLElement | null = node; current; current = current.offsetParent as HTMLElement | null) { x += current.offsetLeft; y += current.offsetTop; }
  return { x, y };
}
type Box = { left: number; top: number; width: number; height: number };
function localBox(node: HTMLElement, origin: { x: number; y: number }): Box {
  const at = pageOffset(node);
  return { left: at.x - origin.x, top: at.y - origin.y, width: node.offsetWidth, height: node.offsetHeight };
}

/** Rendered scale of an element (a camera or a parent tween may scale the scene), so client rects map to layout px. */
function renderScale(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  return el.offsetWidth > 0 && rect.width > 0 ? rect.width / el.offsetWidth : 1;
}

// ---------------------------------------------------------------------------------------------------------------
// Splitting. Words become inline-block spans between the original space text nodes, so lines still break at the
// same spaces; chars become inline-block spans inside their word. Inline blocks lose kerning across their edges, so
// the gaps measured on the untouched text are restored with margins: the split text sits where the original sat.
// Nothing is ever unsplit, so there is no second layout change either.

type SplitState = { words: HTMLElement[]; chars: boolean };
const splits = new WeakMap<HTMLElement, SplitState>();
const counted = new WeakSet<HTMLElement>();
const SKIP = '[data-text-motion-layer]';

function textNodes(el: HTMLElement) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: node => node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

function rangeRect(node: Text, start: number, end: number) {
  const range = document.createRange();
  range.setStart(node, start); range.setEnd(node, end);
  return range.getClientRects()[0] ?? range.getBoundingClientRect();
}

/** Restores measured left edges: each span's right margin takes the difference to the next span's original gap. */
function restoreGaps(spans: HTMLElement[], before: DOMRect[], scale: number) {
  const after = spans.map(span => span.getBoundingClientRect());
  const margins = spans.map((_, index) => {
    const next = index + 1;
    if (next >= spans.length) return 0;
    const sameLine = Math.abs(before[next].top - before[index].top) < before[index].height / 2 && Math.abs(after[next].top - after[index].top) < after[index].height / 2;
    return sameLine ? ((before[next].left - before[index].left) - (after[next].left - after[index].left)) / scale : 0;
  });
  spans.forEach((span, index) => { if (Math.abs(margins[index]) > 0.01) span.style.marginRight = `${(Number.parseFloat(span.style.marginRight) || 0) + margins[index]}px`; });
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const graphemes = (text: string) => segmenter ? Array.from(segmenter.segment(text), part => part.segment) : Array.from(text);

/** Splits every text node not yet in a word (text a swap added later included); the list stays in document order. */
function splitWords(el: HTMLElement): SplitState {
  const scale = renderScale(el), words: HTMLElement[] = [], before: DOMRect[] = [];
  const plan = textNodes(el).filter(node => !node.parentElement?.closest('[data-text-word]')).map(node => {
    const parts: { text: string; word: boolean; rect?: DOMRect }[] = [];
    let offset = 0;
    for (const token of node.data.split(/([ \t\n\r\f]+)/)) {
      if (!token) continue;
      const word = !/^[ \t\n\r\f]+$/.test(token);
      parts.push({ text: token, word, rect: word ? rangeRect(node, offset, offset + token.length) : undefined });
      offset += token.length;
    }
    return { node, parts };
  });
  for (const { node, parts } of plan) {
    if (!parts.some(part => part.word)) continue;
    const fragment = document.createDocumentFragment();
    for (const part of parts) {
      if (!part.word) { fragment.appendChild(document.createTextNode(part.text)); continue; }
      const span = document.createElement('span');
      span.dataset.textWord = '';
      span.style.cssText = 'display:inline-block;white-space:pre';
      span.textContent = part.text;
      fragment.appendChild(span);
      words.push(span); before.push(part.rect!);
    }
    node.replaceWith(fragment);
  }
  restoreGaps(words, before, scale);
  const state = splits.get(el) ?? { words: [], chars: false };
  state.words = Array.from(el.querySelectorAll<HTMLElement>('[data-text-word]')).filter(word => !word.closest(SKIP));
  splits.set(el, state);
  return state;
}

function splitChars(el: HTMLElement) {
  const state = splitWords(el);
  const pending = state.words.filter(word => !word.hasAttribute('data-text-char') && !word.querySelector('[data-text-char]'));
  if (!pending.length) return state;
  // Ligatures cannot survive one span per character. If the font forms any in this text, switch them off for the
  // whole element first, so the measured layout (and the settled text) is the one the split can reproduce.
  const width = () => pending.reduce((sum, word) => sum + word.getBoundingClientRect().width, 0);
  if (!state.chars) {
    const withLigatures = width();
    el.style.fontVariantLigatures = 'none';
    if (Math.abs(width() - withLigatures) < 0.01) el.style.fontVariantLigatures = '';
  }
  const scale = renderScale(el);
  for (const word of pending) {
    const node = word.firstChild;
    if (!(node instanceof Text)) continue;
    const parts = graphemes(node.data);
    if (parts.length < 2) { word.dataset.textChar = ''; continue; }
    const before: DOMRect[] = [];
    let offset = 0;
    for (const part of parts) { before.push(rangeRect(node, offset, offset + part.length)); offset += part.length; }
    const chars = parts.map(part => { const span = document.createElement('span'); span.dataset.textChar = ''; span.style.cssText = 'display:inline-block;white-space:pre'; span.textContent = part; return span; });
    word.replaceChildren(...chars);
    restoreGaps(chars, before, scale);
  }
  state.chars = true;
  return state;
}

type Unit = { members: HTMLElement[]; box: Box; boxes: Box[] };

function units(el: HTMLElement, split: TextSplit): Unit[] {
  const state = split === 'chars' ? splitChars(el) : splitWords(el);
  const origin = pageOffset(el);
  if (split === 'chars') {
    const chars = state.words.flatMap(word => word.hasAttribute('data-text-char') ? [word] : Array.from(word.querySelectorAll<HTMLElement>('[data-text-char]')));
    return chars.map(char => { const box = localBox(char, origin); return { members: [char], box, boxes: [box] }; });
  }
  const boxes = state.words.map(word => localBox(word, origin));
  if (split === 'words') return state.words.map((word, index) => ({ members: [word], box: boxes[index], boxes: [boxes[index]] }));
  const lines: Unit[] = [];
  state.words.forEach((word, index) => {
    const box = boxes[index], line = lines[lines.length - 1];
    if (line && Math.abs(box.top - line.box.top) < Math.max(box.height, line.box.height) / 2) {
      const right = Math.max(line.box.left + line.box.width, box.left + box.width), bottom = Math.max(line.box.top + line.box.height, box.top + box.height);
      line.box.left = Math.min(line.box.left, box.left); line.box.top = Math.min(line.box.top, box.top);
      line.box.width = right - line.box.left; line.box.height = bottom - line.box.top;
      line.members.push(word); line.boxes.push(box);
    } else lines.push({ members: [word], box: { ...box }, boxes: [box] });
  });
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------

/** Frames from a frame count, clamped to a range stored in seconds; never less than one frame. */
function frameCount(value: number | undefined, fps: number, spec: { default: number; range: Range }) {
  const min = Math.max(1, Math.round(spec.range[0] * fps)), max = Math.max(min, Math.round(spec.range[1] * fps));
  return clamp(Math.round(num(value, spec.default * fps)), [min, max]);
}

/** An ease that cannot leave 0..1, for blur: a back or elastic ease would otherwise drive it negative. */
function boundedEase(name: string) {
  const ease = gsap.parseEase(name) ?? gsap.parseEase('power2.out');
  return (progress: number) => progress >= 1 ? 1 : progress <= 0 ? 0 : Math.min(1, Math.max(0, ease(progress)));
}

const GRADIENT: Record<TextEdge, string> = { left: 'to right', right: 'to left', top: 'to bottom', bottom: 'to top' };

type Motion = { y: number; x: number; scale: number; blur: number; rotate: number; opacity: number; clip: TextEdge | null };

/** A property left out, or set to false or null, does not move. */
const off = (value: unknown) => value === undefined || value === null || value === false;

function readMotion(props: TextMotionProps, size: number, kind: 'reveal' | 'exit'): Motion {
  const r = TEXT_MOTION_RANGES.reveal, defaults = kind === 'exit' ? TEXT_MOTION_RANGES.exit : null;
  const pick = (key: 'y' | 'blur' | 'opacity') => defaults?.[key].default ?? r[key].default;
  return {
    y: off(props.y) ? 0 : length(props.y, size, pick('y'), r.y.range),
    x: off(props.x) ? 0 : length(props.x, size, r.x.default, r.x.range),
    scale: off(props.scale) ? 1 : clamp(props.scale === true ? r.scale.default : num(props.scale, r.scale.default), r.scale.range),
    blur: off(props.blur) ? 0 : length(props.blur, size, pick('blur'), r.blur.range),
    rotate: off(props.rotate) ? 0 : clamp(props.rotate === true ? r.rotate.default : num(props.rotate, r.rotate.default), r.rotate.range),
    opacity: off(props.opacity) ? 1 : clamp(props.opacity === true ? pick('opacity') : num(props.opacity, pick('opacity')), r.opacity.range),
    clip: off(props.clip) ? null : props.clip === true ? r.clip.default : (GRADIENT[props.clip] ? props.clip : r.clip.default),
  };
}

/** The mask that wipes one member in from (or out to) an edge; --text-wipe runs 0 → extent + feather in px. */
function wipeMask(edge: TextEdge, unit: Box, member: Box, feather: number) {
  const offset = edge === 'left' ? member.left - unit.left : edge === 'right' ? unit.left + unit.width - member.left - member.width
    : edge === 'bottom' ? unit.top + unit.height - member.top - member.height : member.top - unit.top;
  return `linear-gradient(${GRADIENT[edge]}, #000 calc(var(--text-wipe) - ${feather + offset}px), transparent calc(var(--text-wipe) - ${offset}px))`;
}

export function createTextMotion({ root, fps, timeline }: { root: HTMLElement; fps: number; timeline: () => Timeline }): TextMotion {
  const frame = 1 / fps;
  const snap = (seconds: number) => Math.max(0, Math.round(num(seconds, 0) * fps)) / fps;
  /** Each call builds its own timeline, placed on the active one (a section's while it builds) at a whole frame. */
  const place = (options: Common | undefined) => {
    const parent = options?.tl ?? timeline();
    const tl = gsap.timeline();
    parent.add(tl, snap(options?.at ?? 0));
    return tl;
  };

  function move(name: 'reveal' | 'exit', target: Element | string, options: RevealOptions & ExitOptions = {}) {
    const el = resolveEl(target, root, name), size = fontSize(el), spec = TEXT_MOTION_RANGES[name];
    const split = options.split === 'chars' || options.split === 'lines' ? options.split : 'words';
    const props = (name === 'reveal' ? options.from : options.to) ?? { y: true };
    const motion = readMotion(props, size, name);
    const frames = frameCount(options.frames, fps, spec.seconds);
    const staggerDefault = name === 'reveal' ? TEXT_MOTION_RANGES.reveal.stagger[split] : TEXT_MOTION_RANGES.exit.stagger.default;
    const stagger = clamp(Math.round(num(options.stagger, staggerDefault * fps)), [0, Math.round(TEXT_MOTION_RANGES.reveal.stagger.range[1] * fps)]);
    const feather = length(options.feather, size, TEXT_MOTION_RANGES.reveal.feather.default, TEXT_MOTION_RANGES.reveal.feather.range);
    const ease = options.ease ?? spec.ease, blurEase = boundedEase(ease);
    const list = units(el, split), tl = place(options);
    // Visibility goes on each member and the split spans inside it: a char an earlier reveal made visible would
    // otherwise stay visible inside a word this call hides.
    const shown = (unit: Unit) => unit.members.flatMap(member => [member, ...Array.from(member.querySelectorAll<HTMLElement>('[data-text-word],[data-text-char]'))]);
    if (name === 'reveal') gsap.set(list.flatMap(shown), { visibility: 'hidden' });
    // Only the properties this call moves are tweened.
    const all = { x: [motion.x, 0], y: [motion.y, 0], scale: [motion.scale, 1], rotation: [motion.rotate, 0], opacity: [motion.opacity, 1] } as const;
    const used = (Object.keys(all) as (keyof typeof all)[]).filter(key => all[key][0] !== all[key][1]);
    const moved = Object.fromEntries(used.map(key => [key, all[key][0]])), rest = Object.fromEntries(used.map(key => [key, all[key][1]]));
    list.forEach((unit, index) => {
      const start = index * stagger * frame, end = start + frames * frame;
      unit.members.forEach((member, memberIndex) => {
        const box = unit.boxes[memberIndex];
        // A line turns about its own centre, not each word's.
        const transformOrigin = `${unit.box.left + unit.box.width / 2 - box.left}px ${unit.box.top + unit.box.height / 2 - box.top}px`;
        const [from, to] = name === 'reveal' ? [moved, rest] : [rest, moved];
        if (used.length) tl.fromTo(member, { ...from, transformOrigin }, { ...to, transformOrigin, duration: frames * frame, ease, immediateRender: false }, start);
        if (motion.blur > 0) {
          const [a, b] = name === 'reveal' ? [motion.blur, 0] : [0, motion.blur];
          tl.fromTo(member, { filter: `blur(${a}px)` }, { filter: `blur(${b}px)`, duration: frames * frame, ease: blurEase, immediateRender: false }, start);
          // Exactly 0 at the end of the reveal: the filter is removed, not left at a rounding of zero.
          if (name === 'reveal') tl.set(member, { filter: 'none' }, end);
        }
        if (motion.clip) {
          const extent = (motion.clip === 'left' || motion.clip === 'right' ? unit.box.width : unit.box.height) + feather;
          const mask = wipeMask(motion.clip, unit.box, box, feather);
          const [a, b] = name === 'reveal' ? [0, extent] : [extent, 0];
          tl.fromTo(member, { '--text-wipe': `${a}px`, maskImage: mask, webkitMaskImage: mask }, { '--text-wipe': `${b}px`, maskImage: mask, webkitMaskImage: mask, duration: frames * frame, ease, immediateRender: false }, start);
          if (name === 'reveal') tl.set(member, { maskImage: 'none', webkitMaskImage: 'none' }, end);
        }
      });
      // Visible from its own first frame (reveal) or gone after its last (exit); seeking back restores the state.
      tl.set(shown(unit), { visibility: name === 'reveal' ? 'inherit' : 'hidden' }, name === 'reveal' ? start : end);
    });
    return tl;
  }

  function swap(target: Element | string, text: string, options: SwapOptions = {}) {
    const el = resolveEl(target, root, 'swap'), size = fontSize(el), spec = TEXT_MOTION_RANGES.swap;
    if (typeof text !== 'string') throw new Error('swap(el, text) needs the new text as a string.');
    // An inline element becomes an inline block whose width follows the text; a block keeps its own width.
    const inline = getComputedStyle(el).display.startsWith('inline');
    if (getComputedStyle(el).display === 'inline') el.style.display = 'inline-block';
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.style.whiteSpace = 'nowrap';
    const first = !el.querySelector(':scope > [data-text-swap]');
    // The first swap moves the element's text into a span that stays in flow (it keeps the baseline and height);
    // every word after it is absolutely placed over it.
    let current = Array.from(el.querySelectorAll<HTMLElement>(':scope > [data-text-swap]')).pop() ?? null;
    if (!current) {
      current = document.createElement('span');
      current.dataset.textSwap = '';
      current.style.cssText = 'display:inline-block;white-space:pre';
      while (el.firstChild) current.appendChild(el.firstChild);
      el.appendChild(current);
    }
    const next = document.createElement('span');
    next.dataset.textSwap = '';
    next.style.cssText = 'position:absolute;left:0;top:0;display:inline-block;white-space:pre;visibility:hidden';
    next.textContent = text;
    el.appendChild(next);
    // Over the in-flow text, wherever padding puts it.
    const base = el.querySelector<HTMLElement>(':scope > [data-text-swap]')!;
    next.style.left = `${base.offsetLeft}px`; next.style.top = `${base.offsetTop}px`;
    const oldWidth = current.offsetWidth, newWidth = next.offsetWidth, height = el.offsetHeight;
    const frames = frameCount(options.frames, fps, spec.seconds), duration = frames * frame;
    const overlap = clamp(num(options.overlap, spec.overlap.default), spec.overlap.range);
    const enter = Math.round(frames * (1 - overlap)) * frame;
    const ease = options.ease ?? spec.ease, blur = length(options.blur, size, spec.blur.default, spec.blur.range);
    const direction = options.direction ?? 'up';
    const width = options.width === 'hold' ? 'hold' : 'animate';
    // A fixed slot (07-krea: "fixed clip is essential"). clip-path, unlike overflow, keeps the inline baseline.
    if (options.clip !== false && direction !== 'flip') el.style.clipPath = direction === 'up' || direction === 'down' ? 'inset(0 -0.5em)' : 'inset(-0.5em 0)';
    // Chained swaps: the first call sets the starting width; later ones only widen a held slot.
    const pad = el.offsetWidth - el.clientWidth + Number.parseFloat(getComputedStyle(el).paddingLeft) + Number.parseFloat(getComputedStyle(el).paddingRight);
    if (inline && (first || width === 'hold')) el.style.width = `${Math.max(width === 'hold' ? Math.max(oldWidth, newWidth) + pad : 0, first ? oldWidth + pad : 0, Number.parseFloat(el.style.width) || 0)}px`;
    if (inline) el.style.boxSizing = 'border-box';
    const tl = place(options);
    const sign = direction === 'down' || direction === 'right' ? 1 : -1;
    const axis = direction === 'left' || direction === 'right' ? 'x' : 'y';
    const distance = axis === 'x' ? Math.max(oldWidth, newWidth) : height;
    const out = direction === 'flip' ? { scaleY: 0, transformOrigin: '50% 0%' } : { [axis]: sign * distance };
    const into = direction === 'flip' ? { scaleY: 0, transformOrigin: '50% 100%' } : { [axis]: -sign * distance };
    const still = direction === 'flip' ? { scaleY: 1 } : { [axis]: 0 };
    tl.fromTo(current, { ...still, ...(direction === 'flip' ? { transformOrigin: '50% 0%' } : {}) }, { ...out, duration, ease, immediateRender: false }, 0);
    tl.set(next, { visibility: 'inherit' }, enter);
    tl.fromTo(next, into, { ...still, duration, ease, immediateRender: false }, enter);
    if (blur > 0) {
      const bounded = boundedEase(ease);
      tl.fromTo(current, { filter: 'blur(0px)' }, { filter: `blur(${blur}px)`, duration, ease: bounded, immediateRender: false }, 0);
      tl.fromTo(next, { filter: `blur(${blur}px)` }, { filter: 'blur(0px)', duration, ease: bounded, immediateRender: false }, enter);
      tl.set(next, { filter: 'none' }, enter + duration);
    }
    tl.set(current, { visibility: 'hidden' }, duration);
    if (inline && width === 'animate') tl.fromTo(el, { width: oldWidth + pad }, { width: newWidth + pad, duration: enter + duration, ease, immediateRender: false }, 0);
    return tl;
  }

  function counter(target: Element | string, from: number, to: number, options: CounterOptions = {}) {
    const el = resolveEl(target, root, 'counter'), spec = TEXT_MOTION_RANGES.counter;
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('counter(el, from, to) needs two finite numbers.');
    const format = options.format;
    const decimals = typeof format === 'object' ? clamp(Math.round(num(format.decimals, 0)), [0, 6]) : 0;
    const text = typeof format === 'function' ? (value: number) => String(format(value))
      : (value: number) => {
        const separator = format?.separator ?? ',', fixed = Math.abs(value).toFixed(decimals);
        const [whole, part] = fixed.split('.');
        const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
        return `${value < 0 && Number(fixed) !== 0 ? '-' : ''}${format?.prefix ?? ''}${grouped}${part ? `.${part}` : ''}${format?.suffix ?? ''}`;
      };
    // Fixed-width digits: tabular figures where the font has them, and every digit in a cell as wide as the widest
    // digit either way, so a font without tabular figures does not jitter either.
    if (getComputedStyle(el).display === 'inline') el.style.display = 'inline-block';
    el.style.fontVariantNumeric = 'tabular-nums';
    el.style.whiteSpace = 'nowrap';
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;position:absolute;visibility:hidden;white-space:pre';
    el.appendChild(probe);
    const cell = Math.max(...'0123456789'.split('').map(digit => { probe.textContent = digit; return probe.getBoundingClientRect().width / renderScale(el); }));
    const line = probe.offsetHeight || fontSize(el) * 1.2;
    probe.remove();
    const roll = options.roll === true && typeof format !== 'function';
    const cellStyle = `display:inline-block;width:${cell}px;text-align:center`;
    const scaled = (value: number) => Math.round(Math.abs(value) * 10 ** decimals * 1e6) / 1e6;
    const render = (value: number) => {
      const shown = typeof format === 'function' ? text(value) : text(roll ? Math.trunc(value * 10 ** decimals) / 10 ** decimals : Number(value.toFixed(decimals)));
      if (!roll) { el.innerHTML = Array.from(shown, char => /\d/.test(char) ? `<span style="${cellStyle}">${char}</span>` : escapeHtml(char)).join(''); return; }
      // Odometer: the lowest column turns continuously; a higher column turns only while every column below it
      // passes from 9 to 0, as on a mechanical counter.
      const v = scaled(value);
      let place = 0;
      const chars = Array.from(shown).reverse().map(char => {
        if (!/\d/.test(char)) return escapeHtml(char);
        const unit = 10 ** place++;
        const below = v % unit, position = Math.floor(v / unit) % 10 + (unit === 1 ? v % 1 : Math.max(0, below - (unit - 1)));
        return `<span style="${cellStyle};position:relative;clip-path:inset(0)"><span style="visibility:hidden">0</span><span style="position:absolute;left:0;right:0;top:0;line-height:${line}px;transform:translateY(${-position * line}px)">${'01234567890'.split('').join('<br>')}</span></span>`;
      });
      el.innerHTML = chars.reverse().join('');
    };
    // Reserve the widest value's width, so the block does not shift as digits are added.
    // The first counter on an element shows its start value until it runs; a later one must not overwrite it.
    const shownBefore = counted.has(el) ? el.innerHTML : null;
    render(to);
    const widest = el.offsetWidth;
    render(from);
    el.style.minWidth = `${Math.max(widest, el.offsetWidth, Number.parseFloat(el.style.minWidth) || 0)}px`;
    if (shownBefore !== null) el.innerHTML = shownBefore;
    counted.add(el);
    const frames = frameCount(options.frames, fps, spec.seconds);
    const state = { value: from }, tl = place(options);
    tl.to(state, { value: to, duration: frames * frame, ease: options.ease ?? spec.ease, immediateRender: false, onUpdate: () => render(state.value) }, 0);
    return tl;
  }

  function type(target: Element | string, text: string, options: TypeOptions = {}) {
    const el = resolveEl(target, root, 'type'), size = fontSize(el), spec = TEXT_MOTION_RANGES.type;
    if (typeof text !== 'string' || !text) throw new Error('type(el, text) needs the text to type.');
    const cps = clamp(num(options.cps, spec.cps.default), spec.cps.range);
    const mistakes = clamp(Math.round(num(options.mistakes, spec.mistakes.default)), spec.mistakes.range);
    const holdFrames = Math.round(clamp(num(options.hold, spec.hold.default * fps) / fps, spec.hold.range) * fps);
    const blink = Math.round(clamp(num(options.blink, spec.blink.default), spec.blink.range));
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    // The whole text is laid out from the start with untyped characters hidden, so a word never jumps to the next
    // line halfway through being typed.
    const chars = graphemes(text).map(part => { const span = document.createElement('span'); span.textContent = part; span.style.visibility = 'hidden'; return span; });
    el.replaceChildren(...chars);
    const origin = pageOffset(el);
    const boxes = chars.map(span => localBox(span, origin));
    const caretOptions = typeof options.caret === 'object' ? options.caret : {};
    const caret = options.caret === false ? null : document.createElement('span');
    const caretHeight = size * spec.caretHeight;
    if (caret) {
      caret.dataset.textMotionLayer = '';
      const caretWidth = length(caretOptions.width, size, spec.caretWidth.default, spec.caretWidth.range);
      caret.style.cssText = `position:absolute;left:0;top:0;width:${caretWidth}px;height:${caretHeight}px;background:${caretOptions.color ?? 'currentColor'};visibility:hidden;pointer-events:none`;
      el.appendChild(caret);
    }
    const typo = document.createElement('span');
    typo.dataset.textMotionLayer = '';
    typo.style.cssText = 'position:absolute;left:0;top:0;white-space:pre;visibility:hidden';
    el.appendChild(typo);
    // Seeded from the text and the seed option: the same call types the same mistakes in preview and export.
    let seed = Math.round(num(options.seed, 1)) >>> 0;
    for (const char of text) seed = Math.imul(seed ^ char.charCodeAt(0), 0x45d9f3b) >>> 0;
    const random = () => { seed = (Math.imul(seed ^ (seed >>> 15), 1 | seed) + 0x6d2b79f5) >>> 0; return seed / 4294967296; };
    const candidates = chars.map((span, index) => index).filter(index => index > 0 && /\p{L}/u.test(chars[index].textContent ?? ''));
    const wrongAt = new Set<number>();
    while (wrongAt.size < Math.min(mistakes, candidates.length)) wrongAt.add(candidates[Math.floor(random() * candidates.length)]);
    // One keystroke per step: a typed character, a wrong one, or a backspace. Each step lasts whole frames.
    type Step = { shown: number; wrong: string | null };
    const steps: Step[] = [{ shown: 0, wrong: null }];
    chars.forEach((span, index) => {
      if (wrongAt.has(index)) {
        const right = span.textContent ?? '', letters = 'asdfghjklqwertyuiopzxcvbnm';
        let wrong = letters[Math.floor(random() * letters.length)];
        if (wrong === right.toLowerCase()) wrong = letters[(letters.indexOf(wrong) + 1) % letters.length];
        steps.push({ shown: index, wrong: right === right.toUpperCase() ? wrong.toUpperCase() : wrong }, { shown: index, wrong: null });
      }
      steps.push({ shown: index + 1, wrong: null });
    });
    // Step k starts on the first frame at or after k / cps seconds, so the average rate is the asked cps at any fps.
    const stepAt = (frameIndex: number) => Math.floor((frameIndex * cps) / fps + 1e-6);
    const typingFrames = Math.ceil(((steps.length - 1) * fps) / cps - 1e-6), total = typingFrames + holdFrames;
    const caretAt = (shown: number, wrong: boolean) => {
      const box = shown > 0 ? boxes[shown - 1] : boxes[0];
      const left = shown > 0 ? box.left + box.width : box.left;
      return { left: wrong ? left + typo.offsetWidth : left, top: box.top + (box.height - caretHeight) / 2 };
    };
    let applied = -1;
    const render = (frameIndex: number) => {
      if (frameIndex === applied) return;
      applied = frameIndex;
      const step = steps[Math.min(steps.length - 1, Math.max(0, stepAt(frameIndex)))];
      chars.forEach((span, index) => { span.style.visibility = index < step.shown && frameIndex >= 0 ? 'inherit' : 'hidden'; });
      typo.textContent = step.wrong ?? '';
      const anchor = boxes[Math.min(step.shown, boxes.length - 1)];
      typo.style.transform = `translate(${anchor.left}px, ${anchor.top}px)`;
      typo.style.visibility = step.wrong && frameIndex >= 0 ? 'inherit' : 'hidden';
      if (caret) {
        const where = caretAt(step.shown, !!step.wrong);
        caret.style.transform = `translate(${where.left}px, ${where.top}px)`;
        const blinking = blink > 0 && frameIndex > typingFrames && Math.floor((frameIndex - typingFrames) / blink) % 2 === 1;
        caret.style.visibility = frameIndex >= 0 && frameIndex <= total && !blinking ? 'inherit' : 'hidden';
      }
    };
    render(-1);
    const clock = { frame: -1 }, tl = place(options);
    // The clock runs on whole frames: frame 0 is `at`, and every keystroke lands on a frame boundary.
    // Before `at` the tween rests at time 0 and draws nothing; seeks land just after a frame's time, so `at` itself is frame 0.
    const clockTween = gsap.fromTo(clock, { frame: 0 }, { frame: total + 1, duration: (total + 1) * frame, ease: 'none', immediateRender: false, paused: true,
      onUpdate: () => render(clockTween.time() <= 0 ? -1 : clock.frame >= total + 1 ? total + 1 : Math.floor(clock.frame + 1e-6)) });
    tl.add(clockTween.paused(false), 0);
    return tl;
  }

  function mark(target: Element | string, options: MarkOptions = {}) {
    const el = resolveEl(target, root, 'mark'), size = fontSize(el), spec = TEXT_MOTION_RANGES.mark;
    const style = options.style === 'highlight' || options.style === 'box' ? options.style : 'underline';
    const from = options.from === 'right' || options.from === 'center' ? options.from : 'left';
    const color = options.color ?? (style === 'highlight' ? 'color-mix(in srgb, currentColor 22%, transparent)' : 'currentColor');
    const thickness = length(options.thickness, size, spec.thickness.default, spec.thickness.range);
    const offset = length(options.offset, size, spec.offset.default, spec.offset.range);
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.style.isolation = 'isolate';
    // The text's real line boxes, measured with any split units' transforms set aside, in the element's layout px.
    const moved = Array.from(el.querySelectorAll<HTMLElement>('[data-text-word],[data-text-char]')).map(node => [node, node.style.transform] as const);
    for (const [node] of moved) node.style.transform = 'none';
    const scale = renderScale(el), frameRect = el.getBoundingClientRect();
    const rects: Box[] = [];
    for (const node of textNodes(el)) {
      if (!node.data.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width < 0.5) continue;
        const box = { left: (rect.left - frameRect.left) / scale - el.clientLeft, top: (rect.top - frameRect.top) / scale - el.clientTop, width: rect.width / scale, height: rect.height / scale };
        const line = rects.find(other => Math.abs(other.top + other.height / 2 - (box.top + box.height / 2)) < Math.max(other.height, box.height) / 2);
        if (!line) { rects.push(box); continue; }
        const right = Math.max(line.left + line.width, box.left + box.width), bottom = Math.max(line.top + line.height, box.top + box.height);
        line.left = Math.min(line.left, box.left); line.top = Math.min(line.top, box.top); line.width = right - line.left; line.height = bottom - line.top;
      }
    }
    for (const [node, transform] of moved) node.style.transform = transform;
    rects.sort((a, b) => a.top - b.top);
    if (!rects.length) throw new Error('mark() found no text to mark in that element.');
    const frames = frameCount(options.frames, fps, spec.seconds), ease = options.ease ?? spec.ease, tl = place(options);
    // One continuous sweep: across several lines it runs line after line, each line's share of the frames in
    // proportion to its width; from the centre every line grows at once.
    const totalWidth = rects.reduce((sum, rect) => sum + rect.width, 0);
    let elapsed = 0;
    const shares = rects.map(rect => {
      const span = from === 'center' ? frames : Math.max(1, Math.round(frames * rect.width / totalWidth));
      const start = from === 'center' ? 0 : elapsed;
      elapsed += span;
      return { start: start * frame, duration: span * frame };
    });
    rects.forEach((rect, index) => {
      const layer = document.createElement('span');
      layer.dataset.textMotionLayer = '';
      const pad = style === 'underline' ? 0 : size * 0.08;
      const box = style === 'underline' ? { left: rect.left, top: rect.top + rect.height + offset, width: rect.width, height: thickness } : { left: rect.left - pad, top: rect.top, width: rect.width + pad * 2, height: rect.height };
      layer.style.cssText = `position:absolute;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;pointer-events:none;box-sizing:border-box;z-index:-1;`
        + (style === 'box' ? `border:${thickness}px solid ${color};z-index:auto` : `background:${color}`);
      el.appendChild(layer);
      // Px insets at both ends, so GSAP interpolates like for like across the measured width.
      const w = box.width + 2, v = box.height;
      const inset = (right: number, left: number) => `inset(${-v}px ${right}px ${-v}px ${left}px)`;
      const hidden = from === 'left' ? inset(w, -1) : from === 'right' ? inset(-1, w) : inset(w / 2, w / 2);
      gsap.set(layer, { clipPath: hidden });
      tl.fromTo(layer, { clipPath: hidden }, { clipPath: inset(-1, -1), duration: shares[index].duration, ease, immediateRender: false }, shares[index].start);
    });
    return tl;
  }

  return {
    reveal: (el, options) => move('reveal', el, options),
    exit: (el, options) => move('exit', el, options),
    swap, counter, type, mark,
  };
}

function escapeHtml(text: string) { return text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`); }
