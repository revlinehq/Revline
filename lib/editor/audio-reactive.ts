import { effectControlRange } from './effect-keyframes';
import type { VisualEffects } from './visual-effects';
import { VISUAL_EFFECT_DEFAULTS } from './visual-effects';

/**
 * Audio-reactive motion and effects: a level curve (0..1 at `rate` Hz from timeline second `start`), baked
 * from a music clip's beats or loudness, drives up to four targets on a clip. CSS targets (scale, shake,
 * rotate) move the clip's frame or text; effect controls ("glitch.intensity", "colorGrade.exposure", ...)
 * add to the clip's WebGL effects. Times are timeline seconds, so the curve stays on the music.
 */
export const CSS_REACTIVE_TARGETS = ['scale', 'shake', 'rotate'] as const;
export type CssReactiveTarget = typeof CSS_REACTIVE_TARGETS[number];
export type ReactiveTarget = { property: string; amount: number };
export type AudioReactive = { rate: number; start: number; levels: string; targets: ReactiveTarget[] };
export const MAX_REACTIVE_SAMPLES = 7200, MAX_REACTIVE_TARGETS = 4, REACTIVE_RATE = 30;
const CSS_LIMITS: Record<CssReactiveTarget, [number, number]> = { scale: [-.5, .5], shake: [0, .1], rotate: [-20, 20] };

const isCssTarget = (property: string): property is CssReactiveTarget => (CSS_REACTIVE_TARGETS as readonly string[]).includes(property);
/** Allowed amount for a target: CSS limits, or plus/minus one full range of an effect control. */
export function reactiveAmountRange(property: string): [number, number] | undefined {
  if (isCssTarget(property)) return CSS_LIMITS[property];
  const range = effectControlRange(property);
  return range ? [-(range[1] - range[0]), range[1] - range[0]] : undefined;
}

export function decodeLevels(levels: string) {
  const binary = atob(levels), out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) out[index] = binary.charCodeAt(index);
  return out;
}
export function encodeLevels(values: number[]) {
  let binary = '';
  for (const value of values) binary += String.fromCharCode(Math.round(Math.min(1, Math.max(0, value)) * 255));
  return btoa(binary);
}

export function validateAudioReactive(clip: { kind: string; audioReactive?: AudioReactive }) {
  const reactive = clip.audioReactive;
  if (!reactive) return;
  if (clip.kind === 'audio' || clip.kind === 'effect') throw new Error('Audio-reactive motion applies to footage, image, text or solid clips.');
  if (!Number.isFinite(reactive.rate) || reactive.rate < 10 || reactive.rate > 60 || !Number.isFinite(reactive.start) || reactive.start < 0) throw new Error('The audio level curve has an invalid rate or start.');
  if (typeof reactive.levels !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(reactive.levels) || !reactive.levels.length || reactive.levels.length > Math.ceil(MAX_REACTIVE_SAMPLES / 3) * 4) throw new Error(`The audio level curve needs 1 to ${MAX_REACTIVE_SAMPLES} samples.`);
  if (!reactive.targets?.length || reactive.targets.length > MAX_REACTIVE_TARGETS || new Set(reactive.targets.map(target => target.property)).size !== reactive.targets.length) throw new Error(`Use 1 to ${MAX_REACTIVE_TARGETS} different audio-reactive targets.`);
  for (const target of reactive.targets) {
    const range = reactiveAmountRange(target.property);
    if (!range) throw new Error(`${target.property} cannot react to audio. Use scale, shake, rotate or an effect control such as glitch.intensity.`);
    if (!isCssTarget(target.property) && clip.kind !== 'video' && clip.kind !== 'image') throw new Error('Effect controls react to audio on video or image clips; use scale, shake or rotate on text.');
    if (!Number.isFinite(target.amount) || target.amount < range[0] || target.amount > range[1]) throw new Error(`${target.property} amount must be between ${range[0]} and ${range[1]}.`);
  }
}

/** The level (0..1) at timeline time `time`, linear between samples; 0 outside the curve. */
function levelAt(reactive: Pick<AudioReactive, 'rate' | 'start'>, levels: Uint8Array, time: number) {
  const position = (time - reactive.start) * reactive.rate;
  if (!(position >= 0) || position > levels.length - 1) return 0;
  const index = Math.floor(position), mix = position - index;
  return ((levels[index] ?? 0) * (1 - mix) + (levels[Math.min(levels.length - 1, index + 1)] ?? 0) * mix) / 255;
}

/** Effects with audio-driven controls added to their current values (and their groups enabled). */
export function reactiveEffectsAt<T extends VisualEffects>(effects: T, reactive: AudioReactive | undefined, levels: Uint8Array | undefined, time: number): T {
  if (!reactive || !levels) return effects;
  const level = levelAt(reactive, levels, time);
  const next: Record<string, Record<string, unknown>> = { ...effects } as never;
  for (const target of reactive.targets) {
    if (isCssTarget(target.property)) continue;
    const [group, key] = target.property.split('.'), range = effectControlRange(target.property)!;
    const current = { ...VISUAL_EFFECT_DEFAULTS[group as keyof typeof VISUAL_EFFECT_DEFAULTS], ...(next[group] ?? {}) } as Record<string, unknown>;
    // A group the clip did not use starts from neutral (0 for amounts), so silence leaves the clip untouched.
    const base = effects[group as keyof VisualEffects] ? Number(current[key]) : key === 'exposure' ? 0 : range[0] <= 0 && range[1] >= 0 ? 0 : Number(current[key]);
    next[group] = { ...current, enabled: true, [key]: Math.min(range[1], Math.max(range[0], base + target.amount * level)) };
  }
  return next as T;
}
export const hasReactiveEffects = (reactive?: AudioReactive) => !!reactive?.targets.some(target => !isCssTarget(target.property));

/** Pulses at the given timeline times: instant attack, exponential release over `decay` seconds. */
export function pulseLevels(hits: { time: number; strength: number }[], start: number, end: number, decay: number, rate = REACTIVE_RATE) {
  const count = Math.max(1, Math.min(MAX_REACTIVE_SAMPLES, Math.ceil((end - start) * rate) + 1)), values = new Array<number>(count).fill(0);
  for (const hit of hits) {
    const first = Math.max(0, Math.ceil((hit.time - start) * rate - 1e-6));
    for (let index = first; index < count; index++) {
      const value = hit.strength * Math.exp(-(start + index / rate - hit.time) / decay);
      if (value < .01) break;
      values[index] = Math.max(values[index], value);
    }
  }
  return values;
}

/**
 * Loudness levels from a waveform sampled at timeline times (`sampleAt` returns 0..1 or undefined outside
 * the music). Normalized between a quiet floor and loud peaks, then held with a release of `decay` seconds.
 */
export function energyLevels(sampleAt: (time: number) => number | undefined, start: number, end: number, sensitivity: number, decay: number, rate = REACTIVE_RATE) {
  const count = Math.max(1, Math.min(MAX_REACTIVE_SAMPLES, Math.ceil((end - start) * rate) + 1));
  const raw = Array.from({ length: count }, (_, index) => sampleAt(start + index / rate));
  const known = raw.filter((value): value is number => value !== undefined).sort((a, b) => a - b);
  if (!known.length) throw new Error('The music does not play during this clip.');
  const at = (fraction: number) => known[Math.min(known.length - 1, Math.floor(fraction * known.length))];
  // Higher sensitivity lowers the floor, so quieter moments react too.
  const floor = at(.15 + .6 * (1 - sensitivity)), peak = Math.max(floor + 1e-3, at(.97));
  const release = Math.exp(-1 / (rate * decay));
  let held = 0;
  return raw.map(value => {
    const level = value === undefined ? 0 : Math.min(1, Math.max(0, (value - floor) / (peak - floor))) ** 1.6;
    held = Math.max(level, held * release);
    return held;
  });
}

export type AudioReactiveSource = { id: string; reactive: AudioReactive };
export const audioReactiveSources = (clips: { id: string; audioReactive?: AudioReactive }[]): AudioReactiveSource[] => clips.flatMap(clip => clip.audioReactive?.targets.some(target => isCssTarget(target.property)) ? [{ id: clip.id, reactive: clip.audioReactive }] : []);
export type AudioReactiveController = { setSources(sources: AudioReactiveSource[]): void; dispose(): void };

/** Paint scale, shake and rotate on the shared composition clock (preview and export). */
export function installAudioReactive(initial: AudioReactiveSource[]): AudioReactiveController {
  type Clock = { time(): number; render: (...args: unknown[]) => unknown; eventCallback(name: string, callback?: () => void): unknown; __hfReal?: Clock };
  const host = window as unknown as { __timelines: { revline: Clock }; __revlineAudioReactive?: AudioReactiveController };
  const clock = host.__timelines.revline.__hfReal ?? host.__timelines.revline, composition = document.getElementById('composition')!;
  let sources = initial, decoded = new Map<string, Uint8Array>();
  const nodes = (id: string) => document.querySelectorAll<HTMLElement>(`[data-visual-clip="${CSS.escape(id)}"],[data-text-clip="${CSS.escape(id)}"]`);
  const clear = (node: HTMLElement) => { node.style.removeProperty('scale'); node.style.removeProperty('translate'); node.style.removeProperty('rotate'); };
  // A deterministic wobble per frame, so preview and export shake the same way.
  const noise = (value: number) => { const x = Math.sin(value * 12.9898) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; };
  function paint() {
    const time = clock.time(), width = Number(composition.dataset.width), height = Number(composition.dataset.height), frame = Math.floor(time * 30 + 1e-5);
    for (const { id, reactive } of sources) {
      let levels = decoded.get(id);
      if (!levels) { levels = decodeLevels(reactive.levels); decoded.set(id, levels); }
      const level = levelAt(reactive, levels, time);
      for (const node of Array.from(nodes(id))) {
        let scale = 1, x = 0, y = 0, rotate = 0;
        for (const target of reactive.targets) {
          if (target.property === 'scale') scale += target.amount * level;
          else if (target.property === 'shake') { x += noise(frame + 1) * target.amount * level * width; y += noise(frame + 7.3) * target.amount * level * height; }
          else if (target.property === 'rotate') rotate += target.amount * level;
        }
        node.style.setProperty('scale', String(Math.max(.05, scale)));
        node.style.setProperty('translate', `${x.toFixed(2)}px ${y.toFixed(2)}px`);
        node.style.setProperty('rotate', `${rotate.toFixed(3)}deg`);
      }
    }
  }
  const originalRender = clock.render, originalUpdate = clock.eventCallback('onUpdate') as (() => void) | null;
  const render: Clock['render'] = function (...args) { const result = originalRender.apply(clock, args); paint(); return result; };
  const update = () => { originalUpdate?.(); paint(); };
  clock.render = render; clock.eventCallback('onUpdate', update);
  const controller: AudioReactiveController = {
    setSources(next) {
      const wanted = new Set(next.map(source => source.id));
      for (const source of sources) if (!wanted.has(source.id)) nodes(source.id).forEach(clear);
      sources = next; decoded = new Map(); paint();
    },
    dispose() { if (clock.render === render) clock.render = originalRender; clock.eventCallback('onUpdate', originalUpdate ?? undefined); },
  };
  host.__revlineAudioReactive = controller;
  paint();
  return controller;
}
