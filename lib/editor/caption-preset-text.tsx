import { Fragment, type CSSProperties } from 'react';
import { captionMotion, captionPreset, type CaptionPreset, type ClipCaptionPreset } from './caption-presets';
import { textGradientFill } from './text-gradient';
import { textAppearance, textTypographyStyle } from './text-style';
import type { TemplateTextProps, WordTiming } from './text-templates';

/** CSS cubic-bezier(x1,y1,x2,y2) as a function of progress 0–1 (y may overshoot 1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  const slope = (a: number, b: number, t: number) => 3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t * t;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const d = slope(x1, x2, t); if (Math.abs(d) < 1e-6) break; t -= (at(x1, x2, t) - x) / d; t = Math.max(0, Math.min(1, t)); }
    return at(y1, y2, t);
  };
}
/** The word's spring: eases up past its target and settles (the reviewed page's cubic-bezier(.34,1.45,.5,1)). */
const spring = cubicBezier(.34, 1.45, .5, 1);
/** A new caption line rising in. */
const rise = cubicBezier(.22, 1, .36, 1);
const ease = cubicBezier(.25, .1, .25, 1);
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function rgba(color: string): [number, number, number, number] {
  if (!color || color === 'transparent') return [0, 0, 0, 0];
  let hex = color.replace('#', '');
  if (hex.length <= 4) hex = hex.split('').map(c => c + c).join('');
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), hex.length >= 8 ? n(6) / 255 : 1];
}
/** Colour between a and b (hex or transparent); transparent keeps the other colour's hue. */
export function mixColor(a: string, b: string, amount: number) {
  if (amount <= 0) return a;
  if (amount >= 1) return b;
  const from = rgba(a), to = rgba(b);
  const base = from[3] === 0 ? to : from, target = to[3] === 0 ? from : to;
  const channel = (i: number) => Math.round(base[i] + (target[i] - base[i]) * amount);
  const alpha = from[3] + (to[3] - from[3]) * amount;
  return `rgba(${channel(0)},${channel(1)},${channel(2)},${Math.round(alpha * 1000) / 1000})`;
}

/** Word times relative to the template start; even shares of the clip when the caption has none. */
function timingsFor(count: number, timings: WordTiming[] | undefined, duration: number): WordTiming[] {
  if (timings?.length === count) return timings;
  return Array.from({ length: count }, (_, i) => ({ start: i * duration / count, end: (i + 1) * duration / count }));
}

/** How far a word is into being the spoken one (0–1): it rises when its word starts and falls when the next does. */
function activity(t: number, start: number, next: number, duration: number) {
  if (t < start) return 0;
  const peak = ease(clamp01((Math.min(t, next) - start) / duration));
  return t < next ? peak : peak * (1 - ease(clamp01((t - next) / duration)));
}
/** The word's scale: from `rest` it springs to `pop` at its start, then eases back to 1 when the next word starts. */
function popScale(t: number, start: number, next: number, duration: number, pop: number, rest: number) {
  if (t < start) return rest;
  const up = rest + (pop - rest) * spring(clamp01((Math.min(t, next) - start) / duration));
  return t < next ? up : up + (1 - up) * spring(clamp01((t - next) / duration));
}

type WordState = { index: number; text: string; t: number; start: number; next: number };
/** A scaled word keeps its layout box, so a long word growing by 14% covers the space beside it. Side margins of
 *  about half its growth (a glyph is about 0.6 em wide) keep the gap; neighbours ease aside with it. */
const popRoom = (scale: number, text: string) => scale > 1 ? { marginInline: `${((scale - 1) * Array.from(text).length * .3).toFixed(4)}em` } : {};

function wordStyle(preset: CaptionPreset, props: TemplateTextProps, motion: ReturnType<typeof captionMotion>, word: WordState): CSSProperties | null {
  const { t, start, next } = word, a = activity(t, start, next, motion.colorDuration), said = t >= start;
  const highlight = props.highlightColor, base: CSSProperties = { display: 'inline-block', transformOrigin: '50% 70%', whiteSpace: 'nowrap' };
  if (preset.mode === 'single-word') {
    if (t < start || t >= next) return null;
    const p = spring(clamp01((t - start) / motion.popDuration));
    return { ...base, opacity: clamp01((t - start) / (motion.popDuration * .5)), transform: `rotate(${preset.tilt ?? 0}deg) scale(${.72 + (1.04 - .72) * p})`, color: props.color };
  }
  if (preset.mode === 'reveal') {
    if (!said) return { ...base, opacity: 0, transform: `scale(${motion.revealFrom})`, ...wordBox(preset, props, 0) };
    const scale = popScale(t, start, next, motion.popDuration, motion.popScale, motion.revealFrom);
    return { ...base, opacity: clamp01((t - start) / .18), transform: `scale(${scale})`, ...popRoom(scale, word.text), ...wordBox(preset, props, a), ...wordColor(preset, props, a) };
  }
  const scale = popScale(t, start, next, motion.popDuration, motion.popScale, 1);
  const style: CSSProperties = { ...base, transform: `scale(${scale})`, ...(preset.grow ? {} : popRoom(scale, word.text)), ...wordColor(preset, props, a), ...wordBox(preset, props, a) };
  if (preset.mode === 'fill') style.opacity = said ? (preset.dim ?? .4) + (1 - (preset.dim ?? .4)) * ease(clamp01((t - start) / motion.colorDuration)) : preset.dim ?? .4;
  if (preset.grow) Object.assign(style, { fontSize: `${1 + (preset.grow - 1) * a}em`, lineHeight: a > 0 ? 1 : undefined, letterSpacing: a > .5 ? 0 : undefined });
  if (props.textGradient && a < .5) Object.assign(style, textGradientFill(props.textGradient, props.gradientTime ?? t, props.textStyle ? textAppearance({ textStyle: props.textStyle }, props.resolution).textShadow : undefined));
  else if (props.textGradient) style.color = highlight;
  return style;
}
/** A word in a box (box mode, the Reels chip) takes the box's text colour; a pop word takes the highlight. */
function wordColor(preset: CaptionPreset, props: TemplateTextProps, a: number): CSSProperties {
  if (preset.wordBox) return { color: mixColor(props.color, preset.activeText ?? props.color, a), ...(preset.activeShadow === false && a > 0 ? { textShadow: 'none' } : {}) };
  if (preset.mode === 'pop' && preset.highlight) return { color: mixColor(props.color, props.highlightColor, a) };
  return { color: props.color };
}
function wordBox(preset: CaptionPreset, props: TemplateTextProps, a: number): CSSProperties {
  const box = preset.wordBox;
  if (!box) return {};
  return { padding: `${box.paddingY}em ${box.paddingX}em`, borderRadius: `${box.radius}em`, backgroundColor: mixColor(box.color ?? 'transparent', props.highlightColor, a) };
}

/** A caption in a preset look, word by word. Pure function of the frame: the same frame draws the same pixels in the
 *  editor preview, `getFrames`/`finish` frames and exports. */
export function CaptionPresetText(props: TemplateTextProps & { captionPreset: ClipCaptionPreset }) {
  const preset = captionPreset(props.captionPreset.id), motion = captionMotion(props.captionPreset);
  const t = props.frame / props.fps, seconds = props.durationInFrames / props.fps;
  const tokens = props.text.split(/(\s+)/), words = tokens.filter(token => token && !/^\s+$/.test(token));
  const timings = timingsFor(words.length, props.wordTimings, seconds);
  const enter = rise(clamp01(t / motion.lineDuration));
  const root: CSSProperties = {
    display: 'inline-block', maxWidth: '100%', whiteSpace: 'pre-wrap', fontSize: props.fontSize, color: props.color, fontFamily: props.fontFamily, fontWeight: props.fontWeight,
    ...textTypographyStyle(props.textStyle, props.resolution), ...(props.textStyle ? textAppearance({ textStyle: props.textStyle }, props.resolution) : {}),
    ...(preset.uppercase ? { textTransform: 'uppercase' } : {}),
    ...(preset.wordGap !== undefined ? { wordSpacing: `${preset.wordGap - .26}em` } : {}),
    opacity: props.frame < 0 ? 0 : enter, transform: `translateY(${(1 - enter) * .35}em)`,
  };
  let index = 0;
  return <span data-text-template="karaoke" data-caption-preset={preset.id} data-frame={props.frame} style={root}>{tokens.map((token, key) => {
    if (!token || /^\s+$/.test(token)) return preset.mode === 'single-word' ? null : <Fragment key={key}>{token}</Fragment>;
    const position = index++, timing = timings[position];
    const style = wordStyle(preset, props, motion, { index: position, text: token, t, start: timing.start, next: timings[position + 1]?.start ?? Infinity });
    return style ? <span key={key} data-word-index={position} style={style}>{token}</span> : null;
  })}</span>;
}
