import { Easing, interpolate, spring } from 'remotion';
import { LAB_TEXT_PRESETS, type LabTextPreset } from './remotion-lab-text-presets';

export type LabCategory = 'explainer' | 'typography' | 'tracking' | 'masking' | 'polish' | 'templates';
export type LabScene = 'cards' | 'diagram' | 'arrows' | 'chart' | 'counter' | 'typography' | 'polish';
export type LabWord = { word: string; start: number; end: number };
export type LabItem = { label: string; detail: string; value: number; start: number; trigger: string };
export type LabConfig = {
  scene: LabScene; title: string; subtitle: string; items: LabItem[]; words: LabWord[];
  accent: string; background: string; foreground: string; aspect: 'landscape' | 'portrait';
  fps: number; duration: number; motion: 'spring' | 'ease' | 'linear'; damping: number; stiffness: number;
  entrance: number; distance: number; blur: number; showTranscript: boolean; showGuides: boolean;
  textPreset: LabTextPreset; textSize: number; textStrength: number; textStagger: number; counterPrefix: string; counterSuffix: string;
};
export const LAB_CATEGORIES: { id: LabCategory; label: string; description: string }[] = [
  { id: 'explainer', label: 'Explainers', description: 'Turn a spoken idea into cards, diagrams, arrows, charts and counters.' },
  { id: 'typography', label: 'Typography', description: 'Emphasize speech with timed words, kinetic titles and editable type.' },
  { id: 'tracking', label: 'Tracking', description: 'Track a face in your own clip and attach a label to its motion.' },
  { id: 'masking', label: 'Masking', description: 'Test cutouts, text behind a subject and selective effects.' },
  { id: 'polish', label: 'Motion polish', description: 'Compare easing, spring overshoot and sampled motion blur.' },
  { id: 'templates', label: 'Templates', description: 'Try a complete design, make it yours and keep it for another clip.' },
];
export const LAB_SCENES: { id: LabScene; label: string }[] = [
  { id: 'cards', label: 'Speech cards' }, { id: 'diagram', label: 'Flow diagram' },
  { id: 'arrows', label: 'Callout arrows' }, { id: 'chart', label: 'Animated chart' }, { id: 'counter', label: 'Counter' },
];
export const DEFAULT_LAB_CONFIG: LabConfig = {
  scene: 'cards', title: 'Build three revenue streams.', subtitle: 'ONE IDEA. THREE WAYS TO GROW.',
  items: [
    { label: 'Products', detail: 'Build it once. Sell it again.', value: 42, start: 1.8, trigger: 'products' },
    { label: 'Services', detail: 'Turn your expertise into value.', value: 32, start: 3.2, trigger: 'services' },
    { label: 'Subscriptions', detail: 'Create recurring momentum.', value: 26, start: 4.8, trigger: 'subscriptions' },
  ],
  words: [
    { word: 'Build', start: .3, end: .7 }, { word: 'three', start: .7, end: 1.05 },
    { word: 'revenue', start: 1.05, end: 1.4 }, { word: 'streams:', start: 1.4, end: 1.75 },
    { word: 'products,', start: 1.8, end: 2.7 }, { word: 'services,', start: 3.2, end: 4.2 },
    { word: 'and', start: 4.25, end: 4.65 }, { word: 'subscriptions.', start: 4.8, end: 6.1 },
  ],
  accent: '#d6f484', background: '#111513', foreground: '#f6f8f2', aspect: 'landscape',
  fps: 30, duration: 8, motion: 'spring', damping: 15, stiffness: 150, entrance: .65, distance: 56,
  blur: 0, showTranscript: true, showGuides: false, textPreset: 'karaoke', textSize: 70, textStrength: 1, textStagger: .07,
  counterPrefix: '$', counterSuffix: 'k',
};
export type LabTemplate = { id: string; name: string; description: string; config: LabConfig };
const preset = (patch: Partial<LabConfig>): LabConfig => ({ ...DEFAULT_LAB_CONFIG, ...patch });
export const LAB_TEMPLATES: LabTemplate[] = [
  { id: 'revenue', name: 'Three revenue streams', description: 'Speech-synced cards · the starting point', config: preset({}) },
  { id: 'process', name: 'Make it a system', description: 'Connected steps with a drawn flow', config: preset({ scene: 'diagram', title: 'A simple system that compounds.', subtitle: 'THE GROWTH LOOP', accent: '#b8a0ff', items: [
    { label: 'Create', detail: 'Something worth sharing', start: .7, value: 30, trigger: 'create' },
    { label: 'Distribute', detail: 'Meet your audience', start: 2.2, value: 60, trigger: 'distribute' },
    { label: 'Improve', detail: 'Learn from every cycle', start: 3.7, value: 100, trigger: 'improve' },
  ], showTranscript: false }) },
  { id: 'growth', name: 'Show the growth', description: 'Animated bars and a rolling total', config: preset({ scene: 'chart', title: 'Small wins. Compounding results.', subtitle: 'MONTHLY REVENUE', accent: '#82d6ff', counterSuffix: 'k', showTranscript: false, items: [
    { label: 'January', detail: 'The starting point', start: .6, value: 24, trigger: 'january' },
    { label: 'February', detail: 'Finding momentum', start: 1.7, value: 57, trigger: 'february' },
    { label: 'March', detail: 'A new baseline', start: 2.8, value: 92, trigger: 'march' },
  ] }) },
  { id: 'counter', name: 'Make the number matter', description: 'A count-up with a spring arrival', config: preset({ scene: 'counter', title: 'Your next milestone is closer.', subtitle: 'TOTAL REVENUE', accent: '#ffb99d', showTranscript: false, items: [
    { ...DEFAULT_LAB_CONFIG.items[0], value: 128, start: .7, label: 'Revenue earned' }, ...DEFAULT_LAB_CONFIG.items.slice(1),
  ] }) },
  { id: 'words', name: 'Every word lands', description: 'Speech timing with word emphasis', config: preset({ scene: 'typography', accent: '#ffe177', textPreset: 'karaoke', subtitle: 'SAY IT WITH INTENTION' }) },
  { id: 'stack', name: 'A little more energy', description: 'Staggered kinetic type and violet', config: preset({ scene: 'typography', accent: '#d0b3ff', background: '#181324', textPreset: 'kinetic-stack', title: 'Make every word count.', showTranscript: false }) },
  { id: 'callouts', name: 'Connect the dots', description: 'Three callouts around a central idea', config: preset({ scene: 'arrows', title: 'One offer. More possibilities.', subtitle: 'THE BIG PICTURE', accent: '#f2a5cf', showTranscript: false }) },
];

export function labProgress(config: LabConfig, frame: number, startSeconds = 0) {
  const elapsed = frame - Math.round(startSeconds * config.fps);
  if (elapsed < 0) return 0;
  const durationInFrames = Math.max(1, Math.round(config.entrance * config.fps));
  if (config.motion === 'spring') return spring({ frame: elapsed, fps: config.fps, durationInFrames, config: { damping: config.damping, stiffness: config.stiffness, mass: 1 } });
  return interpolate(elapsed, [0, durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', ...(config.motion === 'ease' ? { easing: Easing.out(Easing.cubic) } : {}),
  });
}

export function retimeWords(text: string, duration: number): LabWord[] {
  const words = text.trim().split(/\s+/).filter(Boolean).slice(0, 120);
  const available = Math.max(.1, duration - .6);
  return words.map((word, i) => ({ word, start: Number((.3 + i * available / words.length).toFixed(2)), end: Number((.3 + (i + 1) * available / words.length).toFixed(2)) }));
}

const cleanWord = (word: string) => word.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function alignLabItems(config: LabConfig) {
  return config.items.map(item => {
    const cue = config.words.find(word => cleanWord(word.word) === cleanWord(item.trigger));
    return cue ? { ...item, start: cue.start } : item;
  });
}

function text(value: unknown, limit: number): value is string { return typeof value === 'string' && value.length <= limit; }
function number(value: unknown, min: number, max: number): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max; }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function hex(value: unknown): value is string { return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value); }

/** Validate all imported and persisted values before a configuration reaches the render clock. */
export function parseLabConfig(input: unknown): LabConfig {
  if (!record(input)) throw new Error('Choose a Revline Remotion template JSON file.');
  const c: Record<string, unknown> = { ...input, textStrength: input.textStrength ?? 1, textStagger: input.textStagger ?? .07 };
  const scenes = [...LAB_SCENES.map(scene => scene.id), 'typography', 'polish'];
  if (!scenes.includes(c.scene as LabScene) || !text(c.title, 200) || !text(c.subtitle, 150)
    || !hex(c.accent) || !hex(c.background) || !hex(c.foreground)
    || !['landscape', 'portrait'].includes(String(c.aspect)) || ![24, 30, 60].includes(c.fps as number)
    || !number(c.duration, 2, 60) || !['spring', 'ease', 'linear'].includes(String(c.motion))
    || !number(c.damping, 3, 40) || !number(c.stiffness, 40, 400) || !number(c.entrance, .15, 3)
    || !number(c.distance, 0, 200) || !number(c.blur, 0, 12) || typeof c.showTranscript !== 'boolean' || typeof c.showGuides !== 'boolean'
    || !LAB_TEXT_PRESETS.includes(c.textPreset as LabTextPreset) || !number(c.textSize, 24, 110)
    || !number(c.textStrength, .2, 2) || !number(c.textStagger, 0, .18)
    || !text(c.counterPrefix, 12) || !text(c.counterSuffix, 12)) throw new Error('The template contains unsupported settings.');
  if (!Array.isArray(c.items) || c.items.length !== 3 || c.items.some(item => !record(item)
    || !text(item.label, 60) || !text(item.detail, 120) || !text(item.trigger, 60)
    || !number(item.value, 0, 1e12) || !number(item.start, 0, c.duration as number))) throw new Error('A template needs three valid timed items.');
  if (!Array.isArray(c.words) || c.words.length > 120 || c.words.some((word, index, all) => !record(word)
    || !text(word.word, 80) || !number(word.start, 0, c.duration as number) || !number(word.end, word.start as number, c.duration as number)
    || index > 0 && (word.start as number) < (all[index - 1] as LabWord).end)) throw new Error('Word timings must be ordered and fit inside the duration.');
  const known = Object.keys(DEFAULT_LAB_CONFIG) as (keyof LabConfig)[];
  return Object.fromEntries(known.map(key => [key, c[key]])) as LabConfig;
}

export function parseLabFile(input: unknown): LabConfig {
  if (!record(input) || input.version !== 1 || input.type !== 'revline-remotion-template') throw new Error('Choose a version 1 Revline Remotion template.');
  return parseLabConfig(input.config);
}

export function labTemplateFile(config: LabConfig) { return { type: 'revline-remotion-template', version: 1, config }; }
